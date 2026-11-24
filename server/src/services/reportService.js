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
  preliminary: 'PRELIMINARY — NOT YET FINAL',
  for_approval: 'PRELIMINARY — NOT YET FINAL',
  approved: 'FINAL RESULTS',
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

/** Signature block: the panel of judges (when known), then the person who prepared and certified the tally. */
function signatoriesFrom(result, judges = []) {
  return [
    ...judges.map((j, i) => ({ label: `Judge ${j.order || i + 1}`, name: j.name || '', role: 'Board of Judges' })),
    { label: 'Prepared and certified by', name: result?.approvedBy?.name || result?.generatedBy?.name || '', role: 'Tabulation Committee' },
  ];
}

const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
/** Marks awardee rows (Top N, from the category's "number of awardees") so the renderers can highlight them. */
const placeOf = (r, n = 3) => (r.rank >= 1 && r.rank <= n ? r.rank : undefined);
const kindOf = (rank) => (rank <= 3 ? `place${rank}` : 'placeN');

/** Winner cards shown above the tables: the Top N awardees plus any special awards. */
function highlightsFrom(rows, awards, dp, n = 3) {
  const podium = (rows || [])
    .filter((r) => placeOf(r, n))
    .map((r) => ({ kind: kindOf(r.rank), title: `${ordinal(r.rank)} Place${r.tied ? ' (tie)' : ''}`, name: `#${r.number} ${r.name}`, value: fmt(r.finalScore, dp) }));
  const special = (awards || [])
    .filter((a) => a.winners?.length)
    .map((a) => ({
      kind: 'award',
      title: a.name + (a.tied ? ' (shared)' : ''),
      name: a.winners.map((w) => `#${w.number} ${w.name}`).join(', '),
      value: fmt(a.winners[0].value, dp),
      sub: (a.basis === 'final' ? 'Highest final score' : `Highest in ${a.criterionName}`) + (a.note ? ` — ${a.note}` : ''),
    }));
  return [...podium, ...special];
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
    ...(usesCriteria ? tally.criteria.map((c, i) => ({ key: `c${i}`, label: `${c.name}${c.weight ? ` (${c.weight}%)` : ""} avg`, align: 'right', width: 13 })) : []),
    { key: 'final', label: tally.scoringMethod === 'rank' || tally.customStrategy === 'rank_of_scores' ? 'Rank Sum' : 'Final Score', align: 'right', width: 12 },
  ];
  const rows = tally.rows.map((r) => {
    const row = { rank: r.rank === null ? '—' : `${r.rank}${r.tied ? ' (tie)' : ''}`, number: r.number, name: r.name, final: fmt(r.finalScore, dp), _place: placeOf(r, category.awardees) };
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
  return { statusLabel, highlights: highlightsFrom(tally.rows, tally.awards, dp, category.awardees), sections, signatories: signatoriesFrom(result, tally.judges) };
}

/** Tally sheet for a saved event-wide overall result. */
async function overallTallyReport({ result }) {
  const dp = result.decimalPlaces ?? 2;
  const cats = result.criteria || [];
  const rankSum = String(result.scoringMethod).includes('rank');
  return {
    statusLabel: `${STATUS_LABEL[result.status]} · Version ${result.version}${result.complete ? '' : ' · INCOMPLETE'}`,
    highlights: highlightsFrom(result.rows, [], dp),
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
          const row = { rank: r.rank === null ? '—' : `${r.rank}${r.tied ? ' (tie)' : ''}`, number: r.number, name: r.name, final: fmt(r.finalScore, dp), _place: placeOf(r) };
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
          _place: placeOf(r, category.awardees),
        })),
      },
    ],
    highlights: highlightsFrom(tally.rows, tally.awards, dp, category.awardees),
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
      rows: r.rows.filter((x) => x.rank !== null).map((x) => ({ rank: `${x.rank}${x.tied ? ' (tie)' : ''}`, number: x.number, name: x.name, final: fmt(x.finalScore, r.decimalPlaces), _place: placeOf(x, categories.find((c) => String(c._id) === String(r.category))?.awardees ?? 3) })),
    });
    const awardsSection = specialAwardsSection(r.awards, r.decimalPlaces, `${r.title} — Special Awards`);
    if (awardsSection) sections.push(awardsSection);
  }
  if (!sections.length) sections.push({ heading: 'No final results yet', columns: [{ key: 'note', label: 'Note' }], rows: [{ note: 'Results appear here once they are finalized.' }] });
  const approver = parts.find((p) => p.approvedBy)?.approvedBy;
  return {
    statusLabel: parts.every((p) => p.status === 'published') && parts.length ? 'OFFICIAL — PUBLISHED' : 'FINAL RESULTS',
    sections,
    signatories: [{ label: 'Prepared and certified by', name: approver?.name || parts[0]?.generatedBy?.name || '', role: 'Tabulation Committee' }],
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
      subheading: settings.reportSubheading || "",
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
    subheading: settings.reportSubheading || "",
    event: eventHeader(event),
    category: category ? category.name : undefined,
    generatedAt: dt(new Date()),
    generatedBy: user.name,
    footer: settings.reportFooter,
    ...body,
  };
}

// ------------------------------------------------------------------ Excel renderer (formal, monochrome)
const XL = { ink: 'FF111111', muted: 'FF555555', line: 'FFBBBBBB', head: 'FFEBEBEB' };

/** Only a non-final result carries a status line; final and published reports show none. */
const statusNote = (label = '') => (/PRELIMINARY|RETURNED|INCOMPLETE|LIVE COMPUTATION/.test(label) ? label : '');

const solid = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = () => ({ top: { style: 'thin', color: { argb: XL.line } }, bottom: { style: 'thin', color: { argb: XL.line } }, left: { style: 'thin', color: { argb: XL.line } }, right: { style: 'thin', color: { argb: XL.line } } });

/** Winners as a plain table: places first, then special awards. */
function winnersSection(report) {
  const list = report.highlights || [];
  if (!list.length) return null;
  const hasRemarks = list.some((h) => h.sub);
  return {
    heading: 'Winners',
    columns: [
      { key: 'title', label: 'Award', width: 24 },
      { key: 'name', label: 'Awardee', width: 32 },
      { key: 'value', label: 'Score', align: 'right', width: 10 },
      ...(hasRemarks ? [{ key: 'sub', label: 'Basis', width: 30 }] : []),
    ],
    rows: list.map((h) => ({ title: h.title, name: h.name, value: h.value, sub: h.sub || '', _bold: h.kind === 'place1' })),
  };
}

export async function reportToExcel(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Overall Tally Management System';
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, horizontalCentered: true, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: '&L&8&"Arial"Generated by the Overall Tally Management System&R&8&"Arial"Page &P of &N' },
  });
  const winners = winnersSection(report);
  const sections = [...(winners ? [winners] : []), ...report.sections];
  const maxCols = Math.max(4, ...sections.map((s) => (s.columns ? s.columns.length : 2)));
  const font = (extra = {}) => ({ name: 'Arial', size: 10, color: { argb: XL.ink }, ...extra });

  const merged = (text, f, { height, align = 'center' } = {}) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, maxCols);
    const cell = row.getCell(1);
    cell.font = f;
    cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
    if (height) row.height = height;
    return row;
  };

  // ---- letterhead
  if (report.organization) merged(report.organization, font({ size: 13, bold: true }), { height: 20 });
  if (report.subheading) merged(report.subheading, font({ size: 11, color: { argb: XL.muted } }), { height: 17 });
  ws.addRow([]);
  merged(report.event.name, font({ size: 15, bold: true }), { height: 22 });
  const subtitle = report.subtitle && report.subtitle !== report.event.name ? ` — ${report.subtitle}` : '';
  merged(`${report.title}${subtitle}`, font({ size: 11 }), { height: 17 });
  const meta = [report.event.date, report.event.venue].filter((v) => v && v !== '—').join('   |   ');
  if (meta) merged(meta, font({ size: 9, color: { argb: XL.muted } }));
  const note = statusNote(report.statusLabel);
  if (note) merged(note, font({ size: 9, bold: true, color: { argb: XL.muted } }));
  const rule = merged('', font());
  rule.height = 6;
  rule.getCell(1).border = { bottom: { style: 'double', color: { argb: XL.ink } } };
  ws.addRow([]);

  // ---- sections
  const widths = new Array(maxCols).fill(10);
  for (const section of sections) {
    merged(section.heading.toUpperCase(), font({ bold: true, size: 10 }), { align: 'left', height: 18 });
    if (section.note) merged(section.note, font({ italic: true, size: 9, color: { argb: XL.muted } }), { align: 'left' });
    if (section.keyValues) {
      for (const [k, v] of section.keyValues) {
        const r = ws.addRow([k, v]);
        r.getCell(1).font = font({ bold: true });
        r.getCell(2).font = font();
        widths[0] = Math.max(widths[0], 24);
        widths[1] = Math.max(widths[1], 30);
      }
    } else {
      const header = ws.addRow(section.columns.map((c) => c.label));
      header.height = 30;
      header.eachCell((cell) => {
        cell.font = font({ bold: true });
        cell.fill = solid(XL.head);
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = thin();
      });
      section.columns.forEach((c, i) => (widths[i] = Math.max(widths[i], c.width || 12)));
      for (const row of section.rows) {
        const r = ws.addRow(
          section.columns.map((c) => {
            const v = row[c.key];
            const num = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
            return num ?? '';
          })
        );
        section.columns.forEach((c, i) => {
          const cell = r.getCell(i + 1);
          cell.alignment = { horizontal: c.align || 'left', vertical: 'middle', wrapText: true };
          cell.border = thin();
          cell.font = font({ bold: !!row._bold });
          // keep the 2-decimal look of scores ("128.00", not "128")
          if (typeof cell.value === 'number' && /\./.test(String(row[c.key]))) cell.numFmt = '0.00';
        });
      }
    }
    ws.addRow([]);
  }
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // ---- signatures (up to 3 per line, each spanning a block of columns)
  const sig = report.signatories || [];
  if (sig.length) {
    ws.addRow([]);
    const perLine = Math.min(3, sig.length);
    const span = Math.max(1, Math.floor(maxCols / perLine));
    for (let i = 0; i < sig.length; i += perLine) {
      const group = sig.slice(i, i + perLine);
      const labels = ws.addRow([]);
      ws.addRow([]);
      const names = ws.addRow([]);
      const roles = ws.addRow([]);
      names.height = 22;
      group.forEach((s, k) => {
        const from = k * span + 1;
        const to = Math.min(maxCols, from + span - 1);
        for (const [row, text, f, h] of [
          [labels, s.label, font({ size: 9, color: { argb: XL.muted } }), 'left'],
          [names, (s.name || '').toUpperCase(), font({ bold: true, size: 10 }), 'center'],
          [roles, s.role || '', font({ size: 9, color: { argb: XL.muted } }), 'center'],
        ]) {
          if (to > from) ws.mergeCells(row.number, from, row.number, to);
          const cell = row.getCell(from);
          cell.value = text;
          cell.font = f;
          cell.alignment = { horizontal: h, vertical: 'bottom' };
        }
        for (let col = from; col <= to; col += 1) names.getCell(col).border = { bottom: { style: 'thin', color: { argb: XL.ink } } };
      });
      ws.addRow([]);
    }
  }
  ws.addRow([]);
  merged(`Generated ${report.generatedAt} by ${report.generatedBy}. ${report.footer || ''}`, font({ size: 8, italic: true, color: { argb: 'FF777777' } }), { align: 'left', height: 16 });

  return wb.xlsx.writeBuffer();
}
