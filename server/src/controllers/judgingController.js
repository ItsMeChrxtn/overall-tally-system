import { z } from 'zod';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Event from '../models/Event.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { decimalsOf, objectId, parse } from '../utils/validation.js';
import { audit } from '../services/auditService.js';
import { emitToEvent } from '../services/realtime.js';
import { getEffectiveConfig } from '../services/tabulationService.js';
import { methodLabel, methodUsesCriteria, round } from '../services/scoringEngine.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { ROLES } from '../constants/index.js';

const scoresSchema = z.array(z.object({ criterion: objectId, value: z.number({ invalid_type_error: 'Scores must be numbers' }) })).max(100);
const sheetBody = z.object({ scores: scoresSchema.optional(), rank: z.number().int().min(1).optional().nullable() });

/** Loads a category the current judge is assigned to, plus its effective (locked) configuration. */
async function loadJudgeCategory(req, categoryId) {
  if (!mongoose.isValidObjectId(categoryId)) throw ApiError.badRequest('Invalid category.');
  const category = await Category.findById(categoryId);
  if (!category) throw ApiError.notFound('Category not found.');
  const assignment = await EventAssignment.findOne({ event: category.event, user: req.user._id, role: ROLES.JUDGE, categories: category._id });
  if (!assignment || req.user.role !== ROLES.JUDGE) throw ApiError.forbidden('You are not assigned to judge this category.');
  const event = await Event.findById(category.event);
  if (event.status === 'archived') throw ApiError.forbidden('This event is archived.');
  const config = await getEffectiveConfig(category);
  return { category, event, assignment, config };
}

function assertScoringOpen(category, config) {
  if (!category.configLocked || !config.locked) throw ApiError.conflict('Scoring has not opened for this category yet.', 'SCORING_NOT_OPEN');
  if (category.status !== 'scoring') throw ApiError.conflict('Scoring for this category is closed.', 'SCORING_CLOSED');
}

function assertJudgeInSnapshot(judgeId, config) {
  if (!config.judges.some((j) => String(j.userId) === String(judgeId))) {
    throw ApiError.forbidden('You were not part of the judging panel when scoring opened for this category.');
  }
}

/** Validates scores against the locked criteria (range + precision) and returns clean values + preview totals. */
function validateScores(config, scores = [], { requireAll }) {
  const criteria = config.criteria;
  const clean = [];
  const seen = new Set();
  for (const s of scores) {
    const c = criteria.find((x) => String(x.criterionId) === String(s.criterion));
    if (!c) throw ApiError.badRequest('A score references a criterion that is not part of this category.', 'INVALID_CRITERION');
    if (seen.has(String(c.criterionId))) throw ApiError.badRequest(`"${c.name}" was scored twice.`);
    seen.add(String(c.criterionId));
    if (!Number.isFinite(s.value)) throw ApiError.badRequest(`Enter a valid number for "${c.name}".`);
    if (s.value < c.minScore || s.value > c.maxScore) {
      throw ApiError.badRequest(`"${c.name}" must be between ${c.minScore} and ${c.maxScore}.`, 'SCORE_OUT_OF_RANGE', { criterion: String(c.criterionId) });
    }
    if (decimalsOf(s.value) > (c.decimalPlaces ?? 2)) {
      throw ApiError.badRequest(`"${c.name}" allows at most ${c.decimalPlaces} decimal place(s).`, 'SCORE_PRECISION', { criterion: String(c.criterionId) });
    }
    clean.push({ criterion: c.criterionId, value: s.value });
  }
  const missing = criteria.filter((c) => !seen.has(String(c.criterionId)));
  if (requireAll && missing.length) throw ApiError.badRequest(`Score every criterion before submitting (missing: ${missing.map((c) => c.name).join(', ')}).`, 'INCOMPLETE_SHEET');
  let computedTotal = null;
  let computedWeighted = null;
  if (!missing.length && criteria.length) {
    computedTotal = round(clean.reduce((a, s) => a + s.value, 0), 4);
    computedWeighted = round(
      criteria.reduce((a, c) => a + (clean.find((s) => String(s.criterion) === String(c.criterionId)).value / c.maxScore) * c.weight, 0),
      4
    );
  }
  return { clean, computedTotal, computedWeighted, complete: missing.length === 0 };
}

function serializeSheet(s) {
  return {
    _id: s._id,
    contestant: s.contestant,
    status: s.status,
    scores: s.scores,
    rank: s.rank,
    computedTotal: s.computedTotal,
    computedWeighted: s.computedWeighted,
    savedAt: s.savedAt,
    submittedAt: s.submittedAt,
    reopenedAt: s.reopenedAt,
    reopenReason: s.reopenReason,
    configVersion: s.configVersion,
  };
}

async function progressFor(category, judgeId) {
  const total = category.contestants.length;
  const submitted = await ScoreSheet.countDocuments({ category: category._id, judge: judgeId, status: 'submitted' });
  return { total, submitted };
}

// ------------------------------------------------------------------ endpoints
export const myAssignments = asyncHandler(async (req, res) => {
  const assignments = await EventAssignment.find({ user: req.user._id, role: ROLES.JUDGE })
    .populate('event', 'name status eventDate venue eventType coverImage')
    .populate('categories', 'name status configLocked scoringMethod customStrategy contestants order');
  const sheets = await ScoreSheet.aggregate([
    { $match: { judge: req.user._id } },
    { $group: { _id: { c: '$category', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const items = assignments
    .filter((a) => a.event && a.event.status !== 'archived')
    .map((a) => ({
      event: a.event,
      seat: a.order,
      categories: [...a.categories]
        .sort((x, y) => x.order - y.order)
        .map((c) => {
          const count = (s) => sheets.find((x) => String(x._id.c) === String(c._id) && x._id.s === s)?.n || 0;
          return {
            _id: c._id,
            name: c.name,
            status: c.status,
            configLocked: c.configLocked,
            methodLabel: methodLabel(c.scoringMethod, c.customStrategy),
            contestants: c.contestants.length,
            submitted: count('submitted'),
            drafts: count('draft') + count('reopened'),
          };
        }),
    }))
    .sort((a, b) => new Date(b.event.eventDate || 0) - new Date(a.event.eventDate || 0));
  res.json({ success: true, items });
});

export const getJudgeCategory = asyncHandler(async (req, res) => {
  const { category, event, config } = await loadJudgeCategory(req, req.params.id);
  const open = category.configLocked && config.locked;
  const contestantIds = config.contestants.map((c) => c.contestantId);
  const [contestants, sheets] = await Promise.all([
    Contestant.find({ _id: { $in: contestantIds } }, 'number name isTeam teamName members representing description photo').lean(),
    ScoreSheet.find({ category: category._id, judge: req.user._id }),
  ]);
  res.json({
    success: true,
    event: { _id: event._id, name: event.name, venue: event.venue, eventDate: event.eventDate },
    category: {
      _id: category._id,
      name: category.name,
      description: category.description,
      instructions: category.instructions,
      status: category.status,
      scoringOpen: open && category.status === 'scoring',
      configLocked: category.configLocked,
      configVersion: category.configVersion,
      scoringMethod: config.scoringMethod,
      customStrategy: config.customStrategy,
      methodLabel: methodLabel(config.scoringMethod, config.customStrategy),
      usesCriteria: methodUsesCriteria(config.scoringMethod),
      decimalPlaces: config.decimalPlaces,
    },
    criteria: open ? config.criteria : [],
    contestants: open
      ? config.contestants
          .map((c) => ({ ...contestants.find((x) => String(x._id) === String(c.contestantId)), _id: c.contestantId, number: c.number, name: c.name }))
          .sort((a, b) => a.number - b.number)
      : [],
    sheets: sheets.map(serializeSheet),
  });
});

/**
 * Core sheet operations, shared by the judge portal (judgeId = the signed-in judge) and by
 * score encoding (judgeId = the judge whose paper sheet the event admin is entering).
 * `req.user` is always the person actually saving, and is what history/audit record.
 */
async function saveDraftFor(ctx, contestantId, body) {
  const { category, config, judgeId } = ctx;
  if (!config.contestants.some((c) => String(c.contestantId) === String(contestantId))) throw ApiError.badRequest('This contestant is not part of the category.');
  const data = parse(sheetBody, body);
  const usesCriteria = methodUsesCriteria(config.scoringMethod);

  const existing = await ScoreSheet.findOne({ category: category._id, judge: judgeId, contestant: contestantId });
  if (existing?.status === 'submitted') throw ApiError.conflict('This score sheet is already submitted and locked.', 'SHEET_LOCKED');

  const update = { savedAt: new Date(), configVersion: category.configVersion };
  if (usesCriteria) {
    const v = validateScores(config, data.scores || [], { requireAll: false });
    Object.assign(update, { scores: v.clean, computedTotal: v.computedTotal, computedWeighted: v.computedWeighted });
  } else {
    if (data.rank !== undefined && data.rank !== null && data.rank > config.contestants.length) throw ApiError.badRequest(`Rank must be between 1 and ${config.contestants.length}.`);
    update.rank = data.rank ?? undefined;
  }

  const sheet = existing || new ScoreSheet({ event: category.event, category: category._id, judge: judgeId, contestant: contestantId, status: 'draft' });
  Object.assign(sheet, update);
  await sheet.save();
  return sheet;
}

async function submitOne(req, ctx, contestantId, data) {
  const { category, config, judgeId } = ctx;
  const usesCriteria = methodUsesCriteria(config.scoringMethod);
  let sheet = await ScoreSheet.findOne({ category: category._id, judge: judgeId, contestant: contestantId });
  if (sheet?.status === 'submitted') throw ApiError.conflict('This score sheet was already submitted.', 'DUPLICATE_SUBMISSION');
  if (!sheet) sheet = new ScoreSheet({ event: category.event, category: category._id, judge: judgeId, contestant: contestantId, status: 'draft' });

  if (usesCriteria) {
    const v = validateScores(config, data?.scores ?? sheet.scores.map((s) => ({ criterion: String(s.criterion), value: s.value })), { requireAll: true });
    Object.assign(sheet, { scores: v.clean, computedTotal: v.computedTotal, computedWeighted: v.computedWeighted });
  } else {
    const rank = data?.rank ?? sheet.rank;
    if (!Number.isInteger(rank) || rank < 1 || rank > config.contestants.length) throw ApiError.badRequest('Every contestant needs a valid rank.');
    sheet.rank = rank;
  }
  const wasReopened = sheet.status === 'reopened';
  const now = new Date();
  const notes = [wasReopened && 'Resubmitted after reopening', ctx.encoded && `Encoded by ${req.user.name}`].filter(Boolean);
  Object.assign(sheet, { status: 'submitted', submittedAt: now, savedAt: now, configVersion: category.configVersion, submissionCount: (sheet.submissionCount || 0) + 1 });
  sheet.history.push({ action: 'submitted', by: req.user._id, at: now, scores: sheet.scores, rank: sheet.rank, note: notes.join('; ') || undefined });
  await sheet.save();
  return { sheet, wasReopened };
}

async function submitAllFor(req, ctx, body) {
  const { category, config, judgeId } = ctx;
  const { sheets: incoming } = parse(
    z.object({ sheets: z.array(z.object({ contestant: objectId, scores: scoresSchema.optional(), rank: z.number().int().min(1).optional().nullable() })).optional() }),
    body
  );
  const usesCriteria = methodUsesCriteria(config.scoringMethod);
  const existing = await ScoreSheet.find({ category: category._id, judge: judgeId });
  const pending = config.contestants.filter((c) => existing.find((s) => String(s.contestant) === String(c.contestantId))?.status !== 'submitted');
  if (!pending.length) throw ApiError.conflict('All score sheets are already submitted.', 'DUPLICATE_SUBMISSION');

  // Validate everything first so the batch is all-or-nothing
  const plan = pending.map((c) => {
    const given = incoming?.find((x) => String(x.contestant) === String(c.contestantId));
    const sheet = existing.find((s) => String(s.contestant) === String(c.contestantId));
    return { c, data: given || (sheet ? { scores: sheet.scores.map((s) => ({ criterion: String(s.criterion), value: s.value })), rank: sheet.rank } : {}) };
  });
  if (usesCriteria) {
    for (const p of plan) {
      try {
        validateScores(config, p.data.scores || [], { requireAll: true });
      } catch (err) {
        throw ApiError.badRequest(`#${p.c.number} ${p.c.name}: ${err.message}`, err.code);
      }
    }
  } else {
    // Rank method: the full ranking must be submitted together and be a valid permutation 1..N
    if (pending.length !== config.contestants.length) {
      throw ApiError.conflict('Some ranks were reopened individually. Reopen all of this judge\'s rank sheets for this category.');
    }
    const ranks = plan.map((p) => p.data.rank);
    const n = config.contestants.length;
    if (ranks.some((r) => !Number.isInteger(r) || r < 1 || r > n)) throw ApiError.badRequest(`Assign every contestant a rank from 1 to ${n}.`);
    if (new Set(ranks).size !== n) throw ApiError.badRequest('Each rank can only be used once.');
  }

  const submitted = [];
  for (const p of plan) {
    const { sheet } = await submitOne(req, ctx, p.c.contestantId, p.data);
    submitted.push({ sheet, contestant: p.c });
  }
  await audit(req, {
    action: ctx.encoded ? 'score.encoded_batch' : 'score.submitted_batch',
    entityType: 'Category',
    entityId: category._id,
    entityLabel: ctx.encoded ? `${category.name} › ${ctx.judgeName}` : category.name,
    event: category.event,
    after: {
      ...(ctx.encoded ? { judge: ctx.judgeName } : {}),
      sheets: submitted.map(({ sheet, contestant }) => ({ contestant: `#${contestant.number} ${contestant.name}`, ...(usesCriteria ? { total: sheet.computedTotal, weighted: sheet.computedWeighted } : { rank: sheet.rank }) })),
    },
  });
  emitToEvent(category.event, 'sheet:submitted', { categoryId: String(category._id), judgeId: String(judgeId) });
  return { submitted: submitted.length, progress: await progressFor(category, judgeId) };
}

/** Judge-portal context: the signed-in judge, who must be on the locked panel and scoring must be open. */
async function judgeContext(req, categoryId) {
  const { category, config } = await loadJudgeCategory(req, categoryId);
  assertScoringOpen(category, config);
  assertJudgeInSnapshot(req.user._id, config);
  return { category, config, judgeId: req.user._id, encoded: false };
}

export const saveDraft = asyncHandler(async (req, res) => {
  const ctx = await judgeContext(req, req.params.id);
  const sheet = await saveDraftFor(ctx, req.params.contestantId, req.body);
  res.json({ success: true, sheet: serializeSheet(sheet) });
});

export const submitSheet = asyncHandler(async (req, res) => {
  const ctx = await judgeContext(req, req.params.id);
  const { category, config } = ctx;
  if (!methodUsesCriteria(config.scoringMethod)) throw ApiError.badRequest('Rank-based categories are submitted all at once.', 'USE_SUBMIT_ALL');
  const contestantId = req.params.contestantId;
  const contestant = config.contestants.find((c) => String(c.contestantId) === String(contestantId));
  if (!contestant) throw ApiError.badRequest('This contestant is not part of the category.');
  const data = parse(sheetBody, req.body);

  const { sheet, wasReopened } = await submitOne(req, ctx, contestantId, data.scores ? data : null);
  await audit(req, {
    action: wasReopened ? 'score.resubmitted' : 'score.submitted',
    entityType: 'ScoreSheet',
    entityId: sheet._id,
    entityLabel: `${category.name} › #${contestant.number} ${contestant.name}`,
    event: category.event,
    after: { scores: sheet.scores.map((s) => ({ criterion: config.criteria.find((c) => String(c.criterionId) === String(s.criterion))?.name, value: s.value })), total: sheet.computedTotal, weighted: sheet.computedWeighted },
  });
  const progress = await progressFor(category, req.user._id);
  emitToEvent(category.event, 'sheet:submitted', { categoryId: String(category._id), judgeId: String(req.user._id), contestantId: String(contestantId) });
  res.json({ success: true, sheet: serializeSheet(sheet), progress });
});

export const submitAll = asyncHandler(async (req, res) => {
  const ctx = await judgeContext(req, req.params.id);
  res.json({ success: true, ...(await submitAllFor(req, ctx, req.body)) });
});

// ------------------------------------------------------------------ score encoding (event admin)
/** Loads a category the current user manages, with its locked configuration. */
async function loadEncodeCategory(req, categoryId) {
  if (!mongoose.isValidObjectId(categoryId)) throw ApiError.badRequest('Invalid category.');
  const category = await Category.findById(categoryId);
  if (!category) throw ApiError.notFound('Category not found.');
  const { event } = await requireEventAccess(req.user, category.event, 'manage');
  assertNotArchived(event);
  const config = await getEffectiveConfig(category);
  return { category, event, config };
}

/** Encoding context for one judge on the locked panel. */
async function encodeContext(req) {
  const { category, config } = await loadEncodeCategory(req, req.params.id);
  assertScoringOpen(category, config);
  const judge = config.judges.find((j) => String(j.userId) === String(req.params.judgeId));
  if (!judge) throw ApiError.badRequest('That judge is not on the locked panel for this category.');
  return { category, config, judgeId: judge.userId, judgeName: judge.name, encoded: true };
}

export const getEncodeCategory = asyncHandler(async (req, res) => {
  const { category, event, config } = await loadEncodeCategory(req, req.params.id);
  const open = category.configLocked && config.locked;
  const contestantIds = config.contestants.map((c) => c.contestantId);
  const [contestants, sheets] = await Promise.all([
    Contestant.find({ _id: { $in: contestantIds } }, 'number name isTeam teamName representing photo').lean(),
    open ? ScoreSheet.find({ category: category._id }) : [],
  ]);
  res.json({
    success: true,
    event: { _id: event._id, name: event.name },
    category: {
      _id: category._id,
      name: category.name,
      instructions: category.instructions,
      status: category.status,
      scoringOpen: open && category.status === 'scoring',
      configLocked: category.configLocked,
      scoringMethod: config.scoringMethod,
      methodLabel: methodLabel(config.scoringMethod, config.customStrategy),
      usesCriteria: methodUsesCriteria(config.scoringMethod),
    },
    criteria: open ? config.criteria : [],
    judges: open ? [...config.judges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [],
    contestants: open
      ? config.contestants
          .map((c) => ({ ...contestants.find((x) => String(x._id) === String(c.contestantId)), _id: c.contestantId, number: c.number, name: c.name }))
          .sort((a, b) => a.number - b.number)
      : [],
    sheets: sheets.map((s) => ({ ...serializeSheet(s), judge: s.judge })),
  });
});

export const encodeSaveDraft = asyncHandler(async (req, res) => {
  const ctx = await encodeContext(req);
  const sheet = await saveDraftFor(ctx, req.params.contestantId, req.body);
  res.json({ success: true, sheet: { ...serializeSheet(sheet), judge: sheet.judge } });
});

export const encodeSubmitAll = asyncHandler(async (req, res) => {
  const ctx = await encodeContext(req);
  res.json({ success: true, ...(await submitAllFor(req, ctx, req.body)) });
});

export const myHistory = asyncHandler(async (req, res) => {
  const sheets = await ScoreSheet.find({ judge: req.user._id, submissionCount: { $gt: 0 } })
    .populate('event', 'name eventDate status settings')
    .populate('category', 'name')
    .populate('contestant', 'number name')
    .sort({ submittedAt: -1 })
    .limit(500)
    .lean();
  const items = sheets
    .filter((s) => s.event)
    .map((s) => {
      const visible = s.event.settings?.judgesCanViewOwnSubmitted !== false;
      return {
        _id: s._id,
        event: { _id: s.event._id, name: s.event.name, eventDate: s.event.eventDate },
        category: s.category,
        contestant: s.contestant,
        status: s.status,
        submittedAt: s.submittedAt,
        submissionCount: s.submissionCount,
        scoresVisible: visible,
        computedTotal: visible ? s.computedTotal : undefined,
        computedWeighted: visible ? s.computedWeighted : undefined,
        rank: visible ? s.rank : undefined,
      };
    });
  res.json({ success: true, items });
});
