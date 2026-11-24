import { z } from 'zod';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parse } from '../utils/validation.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { audit } from '../services/auditService.js';
import { notify } from '../services/notificationService.js';
import { emitToEvent } from '../services/realtime.js';
import { assertNoLockingResult, getEffectiveConfig } from '../services/tabulationService.js';

/** All score sheets of a category (admins & tabulators). */
export const listCategorySheets = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  await requireEventAccess(req.user, category.event, 'review');
  const config = await getEffectiveConfig(category);
  const sheets = await ScoreSheet.find({ category: category._id })
    .populate('judge', 'name')
    .populate('contestant', 'number name')
    .populate('reopenedBy', 'name')
    .sort({ updatedAt: -1 })
    .lean();
  res.json({
    success: true,
    config: { version: config.version, locked: config.locked, criteria: config.criteria, judges: config.judges, contestants: config.contestants, scoringMethod: config.scoringMethod },
    items: sheets.map((s) => ({ ...s, history: undefined, historyCount: s.history?.length || 0 })),
  });
});

/** Judge × contestant submission matrix for monitoring. */
export const categoryProgress = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  await requireEventAccess(req.user, category.event, 'review');
  const config = await getEffectiveConfig(category);
  const sheets = await ScoreSheet.find({ category: category._id }, 'judge contestant status submittedAt savedAt').lean();
  const matrix = config.judges.map((j) => ({
    judgeId: j.userId,
    name: j.name,
    cells: config.contestants.map((c) => {
      const s = sheets.find((x) => String(x.judge) === String(j.userId) && String(x.contestant) === String(c.contestantId));
      return { contestantId: c.contestantId, status: s ? s.status : 'not_started', sheetId: s?._id, submittedAt: s?.submittedAt, savedAt: s?.savedAt };
    }),
  }));
  const expected = config.judges.length * config.contestants.length;
  const submitted = matrix.reduce((a, j) => a + j.cells.filter((c) => c.status === 'submitted').length, 0);
  res.json({ success: true, locked: config.locked, status: category.status, contestants: config.contestants, matrix, expected, submitted });
});

export const getSheet = asyncHandler(async (req, res) => {
  const sheet = await ScoreSheet.findById(req.params.id)
    .populate('judge', 'name')
    .populate('contestant', 'number name')
    .populate('history.by', 'name')
    .populate('reopenedBy', 'name');
  if (!sheet) throw ApiError.notFound('Score sheet not found.');
  await requireEventAccess(req.user, sheet.event, 'review');
  res.json({ success: true, sheet });
});

/**
 * Authorized correction: an Event Admin / Super Admin reopens a submitted sheet with a documented reason.
 * Tabulators can never alter scores; the judge re-enters and resubmits, and every step is audited.
 */
export const reopenSheet = asyncHandler(async (req, res) => {
  const sheet = await ScoreSheet.findById(req.params.id);
  if (!sheet) throw ApiError.notFound('Score sheet not found.');
  const { event } = await requireEventAccess(req.user, sheet.event, 'manage');
  assertNotArchived(event);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }), req.body);
  if (sheet.status !== 'submitted') throw ApiError.conflict('Only submitted sheets can be reopened.');
  const category = await Category.findById(sheet.category);
  await assertNoLockingResult(category);

  const previous = { scores: sheet.scores.map((s) => ({ criterion: String(s.criterion), value: s.value })), rank: sheet.rank, submittedAt: sheet.submittedAt };
  sheet.status = 'reopened';
  sheet.reopenedAt = new Date();
  sheet.reopenedBy = req.user._id;
  sheet.reopenReason = reason;
  sheet.history.push({ action: 'reopened', by: req.user._id, note: reason, scores: sheet.scores, rank: sheet.rank });
  await sheet.save();

  // Ranks are relative to each other, so a rank-based correction reopens the judge's whole ranking
  let siblings = 0;
  if (category.scoringMethod === 'rank') {
    const others = await ScoreSheet.find({ category: category._id, judge: sheet.judge, status: 'submitted', _id: { $ne: sheet._id } });
    for (const o of others) {
      o.status = 'reopened';
      o.reopenedAt = sheet.reopenedAt;
      o.reopenedBy = req.user._id;
      o.reopenReason = reason;
      o.history.push({ action: 'reopened', by: req.user._id, note: reason, rank: o.rank });
      await o.save();
    }
    siblings = others.length;
  }

  if (category.status === 'closed') {
    category.status = 'scoring';
    await category.save();
  }
  const contestant = await Contestant.findById(sheet.contestant, 'number name');
  await audit(req, {
    action: 'score.correction_reopened',
    entityType: 'ScoreSheet',
    entityId: sheet._id,
    entityLabel: `${category.name} › #${contestant?.number} ${contestant?.name}`,
    event: sheet.event,
    before: { status: 'submitted', ...previous },
    after: { status: 'reopened' },
    meta: { reason, judge: String(sheet.judge), ...(siblings ? { alsoReopenedRankSheets: siblings } : {}) },
  });
  await notify(sheet.judge, {
    title: 'Score sheet reopened for correction',
    message: `${category.name} › #${contestant?.number} ${contestant?.name}: ${reason}`,
    link: `/app/judging/${category._id}`,
    type: 'warning',
    event: sheet.event,
  });
  emitToEvent(sheet.event, 'sheet:reopened', { categoryId: String(category._id), judgeId: String(sheet.judge) });
  res.json({ success: true, sheet });
});
