import ExcelJS from 'exceljs';
import AuditLog from '../models/AuditLog.js';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Criterion from '../models/Criterion.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import Setting from '../models/Setting.js';
import TabulationResult from '../models/TabulationResult.js';
import ApiError from '../utils/ApiError.js';
import { computeLiveCategoryTally, getEffectiveConfig } from './tabulationService.js';
import { methodLabel, methodUsesCriteria } from './scoringEngine.js';
import { ROLES } from '../constants/index.js';

/**
 * Every report is built as one neutral structure:
 *   { title, subtitle, statusLabel, event, category, generatedAt, generatedBy,
 *     sections: [{ heading, note, columns: [{key,label,align,width}], rows: [{...}] , keyValues? }],
 *     signatories: [{ label, name, role }], footer }
 * The server renders it to Excel; the client renders the same JSON to PDF (jsPDF) and printable HTML.
 */

export const REPORT_TYPES = {
  tally: { label: 'Overall Tally Sheet', needsCategory: true },
  judge_sheet: { label: 'Individual Judge Score Sheet', needsCategory: true },
  contestant_breakdown: { label: 'Contestant Score Breakdown', needsCategory: true },
  category_ranking: { label: 'Category Ranking', needsCategory: true },
  final_results: { label: 'Final Results', needsCategory: false },
  judge_submission: { label: 'Judge Submission Report', needsCategory: false },
  event_summary: { label: 'Event Summary Report', needsCategory: false },
  audit_trail: { label: 'Audit Trail Report', needsCategory: false, needsManage: true },
};

const STATUS_LABEL = {
  preliminary: 'PRELIMINARY',
  for_approval: 'FOR APPROVAL',
  approved: 'APPROVED',
  returned: 'RETURNED FOR CORRECTION',
  published: 'OFFICIAL — PUBLISHED',
  superseded: 'SUPERSEDED',
};

const fmt = (v, dp = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(dp));
const dt = (d) => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—');

function eventHeader(event) {
  return {
    name: event.name,
    date: event.eventDate ? new Date(event.eventDate).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' }) : '—',
    venue: event.venue || '—',
    organizer: event.organizer || '',
  };
}

function signatoriesFrom(result) {
  return [
    { label: 'Prepared by', name: result?.generatedBy?.name || '', role: 'Tabulator' },
    { label: 'Verified by', name: result?.submittedBy?.name || '', role: 'Tabulator' },
    { label: 'Approved by', name: result?.approvedBy?.name || '', role: 'Event Administrator' },
  ];
}

/** Picks the result to report on: an explicit version, else the latest non-superseded one, else a live computation. */
async function resolveCategoryData(category, resultId) {
  let result = null;
  if (resultId) {
    result = await TabulationResult.findOne({ _id: resultId, category: category._id }).populate('generatedBy submittedBy approvedBy publishedBy', 'name');
    if (!result) throw ApiError.notFound('Result version not found for this category.');
  } else {
    result = await TabulationResult.findOne({ category: category._id, scope: 'category', status: { $ne: 'superseded' } })
      .sort({ version: -1 })
      .populate('generatedBy submittedBy approvedBy publishedBy', 'name');
  }
  if (result) {
    return {
      result,
      statusLabel: `${STATUS_LABEL[result.status]} · Version ${result.version}${result.complete ? '' : ' · INCOMPLETE'}`,
      tally: {
        rows: result.rows,
        judges: result.judges,
        criteria: result.criteria,
        ties: result.ties,
        awards: result.awards,
        missing: result.missing,
        scoringMethod: result.scoringMethod,
        customStrategy: result.customStrategy,
        decimalPlaces: result.decimalPlaces,
        complete: result.complete,
      },
    };
  }
  const { tally } = await computeLiveCategoryTally(category);
  return { result: null, statusLabel: `PRELIMINARY — LIVE COMPUTATION (NOT SAVED)${tally.complete ? '' : ' · INCOMPLETE'}`, tally };
}

function specialAwardsSection(awards, dp, heading = 'Special Awards') {
  if (!awards?.length) return null;
  return {
    heading,
    columns: [
      { key: 'award', label: 'Award', width: 26 },
      { key: 'winner', label: 'Awardee', width: 30 },
      { key: 'basis', label: 'Basis', width: 30 },
      { key: 'score', label: 'Score', align: 'right', width: 12 },
    ],
    rows: awards.map((a) => ({
      award: a.name,
      winner: a.winners.length ? a.winners.map((w) => `#${w.number} ${w.name}`).join(', ') + (a.tied ? ' (shared)' : '') : '—',
      basis: (a.basis === 'final' ? 'Highest final score (1st place)' : `Highest average in "${a.criterionName || '—'}"`) + (a.note ? ` — ${a.note}` : ''),
      score: a.winners.length ? fmt(a.winners[0].value, dp) : '—',
    })),
  };
}

function judgeScoreFor(js, method, strategy, dp) {
  if (!js?.submitted) return '—';
  if (method === 'rank') return String(js.rank);
  if (strategy === 'rank_of_scores') return `${fmt(js.weighted, dp)} (r${js.derivedRank})`;
  if (method === 'total' || method === 'average') return fmt(js.raw, dp);
  return fmt(js.weighted, dp);
}

// ------------------------------------------------------------------ individual reports
async function tallyReport({ category, params }) {
  const { result, statusLabel, tally } = await resolveCategoryData(category, params.result);
  const dp = tally.decimalPlaces ?? 2;
  const usesCriteria = methodUsesCriteria(tally.scoringMethod);
  const columns = [
    { key: 'rank', label: 'Rank', align: 'center', width: 7 },
    { key: 'number', label: 'No.', align: 'center', width: 6 },
    { key: 'name', label: 'Contestant', width: 26 },
    ...tally.judges.map((j, i) => ({ key: `j${i}`, label: j.name || `Judge ${i + 1}`, align: 'right', width: 12 })),
    ...(usesCriteria ? tally.criteria.map((c, i) => ({ key: `c${i}`, label: `${c.name} (${c.weight}%) avg`, align: 'right', width: 13 })) : []),
    { key: 'final', label: tally.scoringMethod === 'rank' || tally.customStrategy === 'rank_of_scores' ? 'Rank Sum' : 'Final Score', align: 'right', width: 12 },
  ];
  const rows = tally.rows.map((r) => {
    const row = { rank: r.rank === null ? '—' : `${r.rank}${r.tied ? ' (tie)' : ''}`, number: r.number, name: r.name, final: fmt(r.finalScore, dp) };
    tally.judges.forEach((j, i) => {
      row[`j${i}`] = judgeScoreFor(r.judgeScores.find((x) => String(x.judgeId) === String(j.judgeId)), tally.scoringMethod, tally.customStrategy, dp);
    });
    if (usesCriteria) tally.criteria.forEach((c, i) => (row[`c${i}`] = fmt(r.criterionAverages.find((x) => String(x.criterionId) === String(c.criterionId))?.average, dp)));
    return row;
  });
  const sections = [
    {
      heading: `Overall Tally — ${category.name}`,
      note: `Scoring method: ${methodLabel(tally.scoringMethod, tally.customStrategy)}. Judge columns show each judge's ${tally.scoringMethod === 'rank' ? 'rank' : tally.scoringMethod === 'total' || tally.scoringMethod === 'average' ? 'total score' : 'weighted score'}.`,
      columns,
      rows,
    },
  ];
  const awardsSection = specialAwardsSection(tally.awards, dp);
  if (awardsSection) sections.push(awardsSection);
  if (tally.ties?.length) {
    sections.push({ heading: 'Tie-Breaking Decisions', columns: [{ key: 'note', label: 'Decision' }], rows: tally.ties.map((t) => ({ note: t.note })) });
  }
  if (tally.missing?.length) {
    sections.push({
      heading: 'Missing / Incomplete Score Sheets',
      columns: [
        { key: 'judge', label: 'Judge' },
        { key: 'contestant', label: 'Contestant' },
        { key: 'reason', label: 'Status' },
      ],
      rows: tally.missing.map((m) => ({ judge: m.judgeName, contestant: `#${m.contestantNumber} ${m.contestantName}`, reason: m.reason.replace('_', ' ') })),
    });
  }
  return { statusLabel, sections, signatories: signatoriesFrom(result) };
}

/** Tally sheet for a saved event-wide overall result. */
async function overallTallyReport({ result }) {
  const dp = result.decimalPlaces ?? 2;
  const cats = result.criteria || [];
  const rankSum = String(result.scoringMethod).includes('rank');
  return {
    statusLabel: `${STATUS_LABEL[result.status]} · Version ${result.version}${result.complete ? '' : ' · INCOMPLETE'}`,
    sections: [
      {
        heading: result.title,
        note: rankSum ? 'Overall = sum of category ranks (lowest wins).' : 'Overall = Σ (category score normalized to 100 × category weight).',
        columns: [
          { key: 'rank', label: 'Rank', align: 'center', width: 7 },
          { key: 'number', label: 'No.', align: 'center', width: 6 },
          { key: 'name', label: 'Contestant', width: 26 },
          ...cats.map((c, i) => ({ key: `k${i}`, label: rankSum ? `${c.name} (rank)` : `${c.name} (${c.weight}%)`, align: 'right', width: 14 })),
          { key: 'final', label: rankSum ? 'Rank Sum' : 'Overall', align: 'right', width: 12 },
        ],
        rows: result.rows.map((r) => {
          const row = { rank: r.rank === null ? '—' : `${r.rank}${r.tied ? ' (tie)' : ''}`, number: r.number, name: r.name, final: fmt(r.finalScore, dp) };
          cats.forEach((c, i) => {
            const s = r.categoryScores.find((x) => String(x.categoryId) === String(c.categoryId));
            row[`k${i}`] = !s?.participated ? '—' : rankSum ? String(s.rank ?? '—') : fmt(s.normalized, dp);
          });
          return row;
        }),
      },
      ...(result.ties?.length ? [{ heading: 'Tie-Breaking Decisions', columns: [{ key: 'note', label: 'Decision' }], rows: result.ties.map((t) => ({ note: t.note })) }] : []),
    ],
    signatories: signatoriesFrom(result),
  };
}

async function rankingReport({ category, params, event }) {
  const { result, statusLabel, tally } = await resolveCategoryData(category, params.result);
  const dp = tally.decimalPlaces ?? 2;
  const contestants = await Contestant.find({ event: event._id }, 'representing').lean();
  return {
    statusLabel,
    sections: [
      {
        heading: `Category Ranking — ${category.name}`,
        note: `Scoring method: ${methodLabel(tally.scoringMethod, tally.customStrategy)}`,
        columns: [
          { key: 'rank', label: 'Rank', align: 'center', width: 8 },
          { key: 'number', label: 'No.', align: 'center', width: 7 },
          { key: 'name', label: 'Contestant', width: 30 },
          { key: 'representing', label: 'Representing', width: 26 },
          { key: 'final', label: 'Final Score', align: 'right', width: 14 },
        ],
        rows: tally.rows.map((r) => ({
          rank: r.rank === null ? '—' : `${r.rank}${r.tied ? ' (tie)' : ''}`,
          number: r.number,
          name: r.name,
          representing: contestants.find((c) => String(c._id) === String(r.contestantId))?.representing || '',
          final: fmt(r.finalScore, dp),
        })),
      },
    ],
    signatories: signatoriesFrom(result),
  };
}

async function judgeSheetReport({ category, params }) {
  const config = await getEffectiveConfig(category);
  const usesCriteria = methodUsesCriteria(config.scoringMethod);
  const dp = config.decimalPlaces ?? 2;
  const judges = params.judge ? config.judges.filter((j) => String(j.userId) === String(params.judge)) : config.judges;
  if (!judges.length) throw ApiError.notFound('Judge not found in this category.');
  const sheets = await ScoreSheet.find({ category: category._id, judge: { $in: judges.map((j) => j.userId) } }).lean();
  const sections = judges.map((j) => {
    const columns = [
      { key: 'number', label: 'No.', align: 'center', width: 7 },
      { key: 'name', label: 'Contestant', width: 26 },
      ...(usesCriteria ? config.criteria.map((c, i) => ({ key: `c${i}`, label: `${c.name} (${c.minScore}–${c.maxScore})`, align: 'right', width: 13 })) : [{ key: 'rank', label: 'Rank', align: 'center', width: 8 }]),
      ...(usesCriteria ? [{ key: 'total', label: 'Total', align: 'right', width: 10 }, { key: 'weighted', label: 'Weighted', align: 'right', width: 10 }] : []),
      { key: 'status', label: 'Status', width: 11 },
      { key: 'submittedAt', label: 'Submitted', width: 18 },
    ];
    const rows = config.contestants.map((c) => {
      const s = sheets.find((x) => String(x.judge) === String(j.userId) && String(x.contestant) === String(c.contestantId));
      const row = { number: c.number, name: c.name, status: s ? s.status : 'not started', submittedAt: s?.status === 'submitted' ? dt(s.submittedAt) : '—' };
      if (usesCriteria) {
        config.criteria.forEach((cr, i) => {
          const v = s?.scores?.find((x) => String(x.criterion) === String(cr.criterionId))?.value;
          row[`c${i}`] = v === undefined ? '—' : String(v);
        });
        row.total = fmt(s?.computedTotal, dp);
        row.weighted = fmt(s?.computedWeighted, dp);
      } else row.rank = s?.rank ?? '—';
      return row;
    });
    return { heading: `Judge Score Sheet — ${j.name}`, note: `Category: ${category.name}`, columns, rows, signature: j.name };
  });
  return {
    statusLabel: config.locked ? `Configuration version ${config.version}` : 'Scoring not yet open',
    sections,
    signatories: judges.length === 1 ? [{ label: 'Judge', name: judges[0].name, role: 'Signature over printed name' }] : judges.map((j) => ({ label: 'Judge', name: j.name, role: 'Signature over printed name' })),
  };
}

async function breakdownReport({ category, params }) {
  const { result, statusLabel, tally } = await resolveCategoryData(category, params.result);
  if (!methodUsesCriteria(tally.scoringMethod)) throw ApiError.badRequest('Score breakdowns are only available for criteria-based scoring methods.');
  const dp = tally.decimalPlaces ?? 2;
  const rows = params.contestant ? tally.rows.filter((r) => String(r.contestantId) === String(params.contestant)) : [...tally.rows].sort((a, b) => a.number - b.number);
  if (!rows.length) throw ApiError.notFound('Contestant not found in this category.');
  const sections = rows.map((r) => ({
    heading: `#${r.number} ${r.name} — Rank ${r.rank ?? '—'}${r.tied ? ' (tie)' : ''} · Final ${fmt(r.finalScore, dp)}`,
    columns: [
      { key: 'criterion', label: 'Criterion', width: 26 },
      ...tally.judges.map((j, i) => ({ key: `j${i}`, label: j.name, align: 'right', width: 12 })),
      { key: 'avg', label: 'Average', align: 'right', width: 11 },
      { key: 'weighted', label: 'Weighted', align: 'right', width: 11 },
    ],
    rows: [
      ...tally.criteria.map((c) => {
        const row = { criterion: `${c.name} (${c.weight}%, max ${c.maxScore})` };
        tally.judges.forEach((j, i) => {
          const js = r.judgeScores.find((x) => String(x.judgeId) === String(j.judgeId));
          row[`j${i}`] = js?.submitted ? String(js.values[String(c.criterionId)]) : '—';
        });
        const ca = r.criterionAverages.find((x) => String(x.criterionId) === String(c.criterionId));
        row.avg = fmt(ca?.average, dp);
        row.weighted = fmt(ca?.weighted, dp);
        return row;
      }),
      (() => {
        const row = { criterion: 'Judge total (weighted)', _bold: true };
        tally.judges.forEach((j, i) => {
          const js = r.judgeScores.find((x) => String(x.judgeId) === String(j.judgeId));
          row[`j${i}`] = js?.submitted ? fmt(js.weighted, dp) : '—';
        });
        row.avg = '';
        row.weighted = fmt(r.criterionAverages.reduce((a, c) => a + (c.weighted || 0), 0), dp);
        return row;
      })(),
    ],
  }));
  return { statusLabel, sections, signatories: signatoriesFrom(result) };
}

async function finalResultsReport({ event }) {
  const categories = await Category.find({ event: event._id }).sort({ order: 1 }).lean();
  const results = await TabulationResult.find({ event: event._id, status: { $in: ['approved', 'published'] } })
    .sort({ version: -1 })
    .populate('approvedBy generatedBy submittedBy', 'name')
    .lean();
  const sections = [];
  const latestFor = (filter) => results.find(filter);
  const overall = latestFor((r) => r.scope === 'overall');
  const parts = [...(overall ? [overall] : []), ...categories.map((c) => latestFor((r) => r.scope === 'category' && String(r.category) === String(c._id))).filter(Boolean)];
  for (const r of parts) {
    sections.push({
      heading: `${r.title} — ${STATUS_LABEL[r.status]} (v${r.version})`,
      note: r.summary?.methodLabel ? `Method: ${r.summary.methodLabel}` : undefined,
      columns: [
        { key: 'rank', label: 'Rank', align: 'center', width: 8 },
        { key: 'number', label: 'No.', align: 'center', width: 7 },
        { key: 'name', label: 'Contestant', width: 34 },
        { key: 'final', label: 'Final Score', align: 'right', width: 14 },
      ],
      rows: r.rows.filter((x) => x.rank !== null).map((x) => ({ rank: `${x.rank}${x.tied ? ' (tie)' : ''}`, number: x.number, name: x.name, final: fmt(x.finalScore, r.decimalPlaces) })),
    });
    const awardsSection = specialAwardsSection(r.awards, r.decimalPlaces, `${r.title} — Special Awards`);
    if (awardsSection) sections.push(awardsSection);
  }
  if (!sections.length) sections.push({ heading: 'No approved results yet', columns: [{ key: 'note', label: 'Note' }], rows: [{ note: 'Results appear here once they are approved.' }] });
  const approver = parts.find((p) => p.approvedBy)?.approvedBy;
  return {
    statusLabel: parts.every((p) => p.status === 'published') && parts.length ? 'OFFICIAL — PUBLISHED' : 'APPROVED RESULTS',
    sections,
    signatories: [
      { label: 'Prepared by', name: parts[0]?.generatedBy?.name || '', role: 'Tabulator' },
      { label: 'Verified by', name: parts[0]?.submittedBy?.name || '', role: 'Tabulator' },
      { label: 'Approved by', name: approver?.name || '', role: 'Event Administrator' },
    ],
  };
}

async function submissionReport({ event }) {
  const categories = await Category.find({ event: event._id }).sort({ order: 1 });
  const sections = [];
  for (const category of categories) {
    const config = await getEffectiveConfig(category);
    const sheets = await ScoreSheet.find({ category: category._id }).lean();
    sections.push({
      heading: `${category.name} (${config.locked ? 'scoring open/locked' : 'setup'})`,
      columns: [
        { key: 'judge', label: 'Judge', width: 28 },
        { key: 'submitted', label: 'Submitted', align: 'center', width: 11 },
        { key: 'draft', label: 'Draft / Reopened', align: 'center', width: 15 },
        { key: 'notStarted', label: 'Not Started', align: 'center', width: 12 },
        { key: 'expected', label: 'Expected', align: 'center', width: 10 },
        { key: 'last', label: 'Last Submission', width: 20 },
      ],
      rows: config.judges.map((j) => {
        const mine = sheets.filter((s) => String(s.judge) === String(j.userId) && config.contestants.some((c) => String(c.contestantId) === String(s.contestant)));
        const submitted = mine.filter((s) => s.status === 'submitted');
        const last = submitted.map((s) => s.submittedAt).sort((a, b) => new Date(b) - new Date(a))[0];
        return {
          judge: j.name,
          submitted: submitted.length,
          draft: mine.filter((s) => s.status !== 'submitted').length,
          notStarted: config.contestants.length - mine.length,
          expected: config.contestants.length,
          last: dt(last),
        };
      }),
    });
  }
  return { statusLabel: `As of ${dt(new Date())}`, sections, signatories: [{ label: 'Prepared by', name: '', role: 'Tabulator' }] };
}

async function summaryReport({ event }) {
  const [categories, staff, contestants, results] = await Promise.all([
    Category.find({ event: event._id }).sort({ order: 1 }),
    EventAssignment.find({ event: event._id }).populate('user', 'name email title affiliation').populate('categories', 'name').sort({ role: 1, order: 1 }),
    Contestant.find({ event: event._id }).sort({ number: 1 }),
    TabulationResult.find({ event: event._id, status: { $ne: 'superseded' } }).sort({ version: -1 }).lean(),
  ]);
  const criteria = await Criterion.find({ event: event._id, isActive: true }).sort({ order: 1 });
  const sections = [
    {
      heading: 'Event Information',
      keyValues: [
        ['Event', event.name],
        ['Type', event.eventType],
        ['Status', event.status.replace(/_/g, ' ')],
        ['Event date', event.eventDate ? new Date(event.eventDate).toLocaleDateString('en-PH', { dateStyle: 'long' }) : '—'],
        ['Venue', event.venue || '—'],
        ['Organizer', event.organizer || '—'],
        ['Categories', String(categories.length)],
        ['Contestants', String(contestants.filter((c) => c.status === 'active').length)],
        ['Judges', String(staff.filter((s) => s.role === ROLES.JUDGE).length)],
      ],
    },
    {
      heading: 'Categories & Scoring Configuration',
      columns: [
        { key: 'name', label: 'Category', width: 24 },
        { key: 'method', label: 'Method', width: 22 },
        { key: 'criteria', label: 'Criteria', width: 40 },
        { key: 'contestants', label: 'Contestants', align: 'center', width: 11 },
        { key: 'status', label: 'Scoring', width: 10 },
        { key: 'result', label: 'Result', width: 14 },
      ],
      rows: categories.map((c) => {
        const latest = results.find((r) => String(r.category) === String(c._id));
        return {
          name: c.name,
          method: methodLabel(c.scoringMethod, c.customStrategy),
          criteria: criteria
            .filter((k) => String(k.category) === String(c._id))
            .map((k) => `${k.name} ${k.weight}%`)
            .join(', ') || '—',
          contestants: c.contestants.length,
          status: c.status,
          result: latest ? `${latest.status.replace('_', ' ')} v${latest.version}` : '—',
        };
      }),
    },
    {
      heading: 'Officials',
      columns: [
        { key: 'role', label: 'Role', width: 14 },
        { key: 'name', label: 'Name', width: 26 },
        { key: 'details', label: 'Title / Affiliation', width: 30 },
        { key: 'categories', label: 'Categories', width: 30 },
      ],
      rows: staff
        .filter((s) => s.user)
        .map((s) => ({
          role: s.role.replace('_', ' '),
          name: s.user.name,
          details: [s.user.title, s.user.affiliation].filter(Boolean).join(', '),
          categories: s.role === ROLES.JUDGE ? s.categories.map((c) => c.name).join(', ') : 'All',
        })),
    },
    {
      heading: 'Contestants',
      columns: [
        { key: 'number', label: 'No.', align: 'center', width: 7 },
        { key: 'name', label: 'Name', width: 28 },
        { key: 'representing', label: 'Representing', width: 26 },
        { key: 'type', label: 'Type', width: 10 },
        { key: 'status', label: 'Status', width: 12 },
      ],
      rows: contestants.map((c) => ({ number: c.number, name: c.name, representing: c.representing || '', type: c.isTeam ? 'Team' : 'Individual', status: c.status })),
    },
  ];
  return { statusLabel: `As of ${dt(new Date())}`, sections, signatories: [{ label: 'Prepared by', name: '', role: 'Event Administrator' }] };
}

async function auditReport({ event, params }) {
  const filter = { event: event._id };
  if (params.from || params.to) {
    filter.createdAt = {};
    if (params.from) filter.createdAt.$gte = new Date(params.from);
    if (params.to) filter.createdAt.$lte = new Date(new Date(params.to).getTime() + 86399999);
  }
  const logs = await AuditLog.find(filter).sort({ createdAt: 1 }).limit(5000).lean();
  const short = (o) => (o && Object.keys(o).length ? JSON.stringify(o).slice(0, 300) : '');
  return {
    statusLabel: `${logs.length} entr${logs.length === 1 ? 'y' : 'ies'}`,
    sections: [
      {
        heading: 'Audit Trail',
        columns: [
          { key: 'at', label: 'Date / Time', width: 19 },
          { key: 'user', label: 'User', width: 18 },
          { key: 'action', label: 'Action', width: 24 },
          { key: 'record', label: 'Record', width: 28 },
          { key: 'before', label: 'Previous Value', width: 30 },
          { key: 'after', label: 'New Value', width: 30 },
        ],
        rows: logs.map((l) => ({ at: dt(l.createdAt), user: `${l.userName || 'System'}${l.userRole ? ` (${l.userRole.replace('_', ' ')})` : ''}`, action: l.action, record: l.entityLabel || '', before: short(l.before), after: short(l.after || l.meta) })),
      },
    ],
    signatories: [{ label: 'Certified by', name: '', role: 'System Administrator' }],
  };
}

const BUILDERS = {
  tally: tallyReport,
  judge_sheet: judgeSheetReport,
  contestant_breakdown: breakdownReport,
  category_ranking: rankingReport,
  final_results: finalResultsReport,
  judge_submission: submissionReport,
  event_summary: summaryReport,
  audit_trail: auditReport,
};

export async function buildReport({ event, type, params, user }) {
  const def = REPORT_TYPES[type];
  if (!def) throw ApiError.badRequest('Unknown report type.');
  let category = null;
  // An overall (multi-category) result has no category: render its own tally sheet
  if (type === 'tally' && !params.category && params.result) {
    const result = await TabulationResult.findOne({ _id: params.result, event: event._id, scope: 'overall' }).populate('generatedBy submittedBy approvedBy publishedBy', 'name');
    if (!result) throw ApiError.badRequest('Choose a category for this report.');
    const settings = await Setting.getGlobal();
    const body = await overallTallyReport({ result });
    return {
      type,
      title: def.label,
      subtitle: result.title,
      organization: settings.organizationName || settings.systemName,
      event: eventHeader(event),
      generatedAt: dt(new Date()),
      generatedBy: user.name,
      footer: settings.reportFooter,
      ...body,
    };
  }
  if (def.needsCategory) {
    if (!params.category) throw ApiError.badRequest('Choose a category for this report.');
    category = await Category.findOne({ _id: params.category, event: event._id });
    if (!category) throw ApiError.notFound('Category not found in this event.');
  }
  const settings = await Setting.getGlobal();
  const body = await BUILDERS[type]({ event, category, params, user });
  return {
    type,
    title: def.label,
    subtitle: category ? category.name : undefined,
    organization: settings.organizationName || settings.systemName,
    event: eventHeader(event),
    category: category ? category.name : undefined,
    generatedAt: dt(new Date()),
    generatedBy: user.name,
    footer: settings.reportFooter,
    ...body,
  };
}

// ------------------------------------------------------------------ Excel renderer
export async function reportToExcel(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Overall Tally Management System';
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const maxCols = Math.max(4, ...report.sections.map((s) => (s.columns ? s.columns.length : 2)));

  const addMerged = (text, font, height) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, maxCols);
    row.getCell(1).font = font;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (height) row.height = height;
    return row;
  };

  if (report.organization) addMerged(report.organization, { size: 10, color: { argb: 'FF475569' } });
  addMerged(report.event.name, { size: 16, bold: true }, 24);
  addMerged(`${report.title}${report.subtitle ? ` — ${report.subtitle}` : ''}`, { size: 12, bold: true });
  addMerged(`${report.event.date} · ${report.event.venue}`, { size: 10, color: { argb: 'FF475569' } });
  addMerged(report.statusLabel || '', { size: 10, bold: true, color: { argb: 'FF1D4ED8' } });
  ws.addRow([]);

  const widths = new Array(maxCols).fill(12);
  for (const section of report.sections) {
    const h = ws.addRow([section.heading]);
    ws.mergeCells(h.number, 1, h.number, maxCols);
    h.getCell(1).font = { bold: true, size: 12 };
    if (section.note) {
      const n = ws.addRow([section.note]);
      ws.mergeCells(n.number, 1, n.number, maxCols);
      n.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
    }
    if (section.keyValues) {
      for (const [k, v] of section.keyValues) {
        const r = ws.addRow([k, v]);
        r.getCell(1).font = { bold: true };
      }
    } else {
      const header = ws.addRow(section.columns.map((c) => c.label));
      header.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
      section.columns.forEach((c, i) => (widths[i] = Math.max(widths[i], c.width || 12)));
      for (const row of section.rows) {
        const r = ws.addRow(section.columns.map((c) => {
          const v = row[c.key];
          const num = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
          return num ?? '';
        }));
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          const c = section.columns[col - 1];
          if (!c) return;
          cell.alignment = { horizontal: c.align || 'left', vertical: 'middle', wrapText: true };
          cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } };
          if (row._bold) cell.font = { bold: true };
        });
      }
    }
    ws.addRow([]);
  }
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.addRow([]);
  const sig = report.signatories || [];
  if (sig.length) {
    const labels = ws.addRow(sig.flatMap((s) => [s.label, '']));
    labels.font = { size: 9, color: { argb: 'FF64748B' } };
    ws.addRow([]);
    const names = ws.addRow(sig.flatMap((s) => [s.name || '______________________', '']));
    names.font = { bold: true };
    ws.addRow(sig.flatMap((s) => [s.role, ''])).font = { size: 9, color: { argb: 'FF64748B' } };
  }
  ws.addRow([]);
  const foot = ws.addRow([`Generated ${report.generatedAt} by ${report.generatedBy}. ${report.footer || ''}`]);
  ws.mergeCells(foot.number, 1, foot.number, maxCols);
  foot.getCell(1).font = { size: 8, italic: true, color: { argb: 'FF94A3B8' } };

  return wb.xlsx.writeBuffer();
}
