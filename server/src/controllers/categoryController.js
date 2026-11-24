import { z } from 'zod';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Criterion from '../models/Criterion.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ScoringConfiguration from '../models/ScoringConfiguration.js';
import TabulationResult from '../models/TabulationResult.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectId, parse } from '../utils/validation.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { audit, diff } from '../services/auditService.js';
import { emitToEvent } from '../services/realtime.js';
import { checkConfiguration, judgesForCategory, lockConfiguration, reopenConfiguration } from '../services/tabulationService.js';
import { CUSTOM_STRATEGY_REGISTRY, methodLabel } from '../services/scoringEngine.js';
import { CUSTOM_STRATEGIES, ROLES, SCORING_METHODS, TIE_RULES } from '../constants/index.js';

const SCORING_FIELDS = ['scoringMethod', 'customStrategy', 'decimalPlaces', 'tieBreakRules'];
const GENERAL_FIELDS = ['name', 'description', 'instructions', 'order', 'includeInOverall', 'overallWeight'];

const tieRule = z.object({ type: z.enum(TIE_RULES), criterion: objectId.optional().nullable(), judge: objectId.optional().nullable() });
const categoryBody = z.object({
  name: z.string().trim().min(2, 'Category name is required').max(160),
  description: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().max(2000).optional(),
  order: z.number().int().min(0).optional(),
  scoringMethod: z.enum(SCORING_METHODS).optional(),
  customStrategy: z.enum(CUSTOM_STRATEGIES).optional().nullable(),
  decimalPlaces: z.number().int().min(0).max(4).optional(),
  tieBreakRules: z.array(tieRule).max(10).optional(),
  includeInOverall: z.boolean().optional(),
  overallWeight: z.number().min(0, 'Weight cannot be negative').max(100).optional(),
});

function normalizeRules(rules) {
  if (!rules) return rules;
  const out = [];
  for (const r of rules) {
    if (r.type === 'criterion' && !r.criterion) throw ApiError.badRequest('Choose the criterion for the "designated criterion" tie-break rule.');
    if (r.type === 'judge' && !r.judge) throw ApiError.badRequest('Choose the judge for the "specified judge" tie-break rule.');
    out.push({ type: r.type, criterion: r.type === 'criterion' ? r.criterion : undefined, judge: r.type === 'judge' ? r.judge : undefined });
    if (r.type === 'shared') break; // nothing after "shared" can apply
  }
  return out;
}

async function loadCategory(req, capability = 'review') {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  const access = await requireEventAccess(req.user, category.event, capability);
  return { category, ...access };
}

function assertUnlocked(category) {
  if (category.configLocked) {
    throw ApiError.conflict('Scoring has started and the configuration is locked. Formally reopen the configuration to make changes.', 'CONFIG_LOCKED');
  }
}

export const listCategories = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'review');
  const categories = await Category.find({ event: event._id }).sort({ order: 1, createdAt: 1 }).lean();
  const ids = categories.map((c) => c._id);
  const [criteria, judges, sheets, results] = await Promise.all([
    Criterion.find({ category: { $in: ids }, isActive: true }, 'category weight').lean(),
    EventAssignment.find({ event: event._id, role: ROLES.JUDGE }, 'categories').lean(),
    ScoreSheet.aggregate([{ $match: { category: { $in: ids } } }, { $group: { _id: { c: '$category', s: '$status' }, n: { $sum: 1 } } }]),
    TabulationResult.find({ category: { $in: ids }, scope: 'category', status: { $ne: 'superseded' } }, 'category version status').sort({ version: -1 }).lean(),
  ]);
  const items = categories.map((c) => {
    const key = String(c._id);
    const crit = criteria.filter((x) => String(x.category) === key);
    const judgeCount = judges.filter((a) => a.categories.some((x) => String(x) === key)).length;
    const submitted = sheets.find((s) => String(s._id.c) === key && s._id.s === 'submitted')?.n || 0;
    const latest = results.find((r) => String(r.category) === key);
    return {
      ...c,
      methodLabel: methodLabel(c.scoringMethod, c.customStrategy),
      stats: {
        criteria: crit.length,
        totalWeight: +crit.reduce((a, x) => a + (x.weight || 0), 0).toFixed(4),
        judges: judgeCount,
        contestants: c.contestants.length,
        expectedSheets: judgeCount * c.contestants.length,
        submittedSheets: submitted,
      },
      latestResult: latest ? { _id: latest._id, version: latest.version, status: latest.status } : null,
    };
  });
  res.json({ success: true, items });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'manage');
  assertNotArchived(event);
  const data = parse(categoryBody, req.body);
  if (data.scoringMethod === 'custom' && !data.customStrategy) throw ApiError.badRequest('Choose a custom scoring strategy.');
  const count = await Category.countDocuments({ event: event._id });
  const category = await Category.create({
    ...data,
    tieBreakRules: normalizeRules(data.tieBreakRules) ?? [{ type: 'highest_weight_criterion' }, { type: 'shared' }],
    customStrategy: data.scoringMethod === 'custom' ? data.customStrategy : null,
    order: data.order ?? count + 1,
    event: event._id,
    createdBy: req.user._id,
  });
  await audit(req, { action: 'category.created', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: event._id, after: data });
  emitToEvent(event._id, 'category:updated', { categoryId: String(category._id) });
  res.status(201).json({ success: true, category });
});

export const getCategory = asyncHandler(async (req, res) => {
  const { category, can } = await loadCategory(req, 'review');
  const [criteria, judges, contestants, versions, results, check] = await Promise.all([
    Criterion.find({ category: category._id }).sort({ order: 1, createdAt: 1 }),
    judgesForCategory(category),
    Contestant.find({ _id: { $in: category.contestants } }).sort({ number: 1 }),
    ScoringConfiguration.find({ category: category._id }, 'version scoringMethod lockedAt lockedBy reopenedAt reopenReason').populate('lockedBy', 'name').sort({ version: -1 }),
    TabulationResult.find({ category: category._id, scope: 'category' }, 'version status complete generatedAt submittedAt approvedAt publishedAt returnReason').sort({ version: -1 }),
    category.configLocked ? null : checkConfiguration(category),
  ]);
  res.json({
    success: true,
    category,
    methodLabel: methodLabel(category.scoringMethod, category.customStrategy),
    criteria,
    judges,
    contestants,
    versions,
    results,
    configCheck: check ? { ok: check.ok, errors: check.errors, warnings: check.warnings } : null,
    customStrategies: Object.entries(CUSTOM_STRATEGY_REGISTRY).map(([key, v]) => ({ key, label: v.label })),
    can,
  });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  const data = parse(categoryBody.partial(), req.body);
  const touchesScoring = SCORING_FIELDS.some((f) => data[f] !== undefined);
  if (touchesScoring) assertUnlocked(category);
  const before = category.toObject();
  for (const f of [...GENERAL_FIELDS, ...SCORING_FIELDS]) {
    if (data[f] === undefined) continue;
    category[f] = f === 'tieBreakRules' ? normalizeRules(data[f]) : data[f];
  }
  if (category.scoringMethod !== 'custom') category.customStrategy = null;
  else if (!category.customStrategy) throw ApiError.badRequest('Choose a custom scoring strategy.');
  await category.save();
  const d = diff(before, category.toObject(), [...GENERAL_FIELDS, ...SCORING_FIELDS]);
  if (d.changed) {
    await audit(req, {
      action: touchesScoring ? 'category.scoring_config_changed' : 'category.updated',
      entityType: 'Category',
      entityId: category._id,
      entityLabel: category.name,
      event: category.event,
      before: d.before,
      after: d.after,
    });
  }
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id) });
  res.json({ success: true, category });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  const [submitted, results] = await Promise.all([
    ScoreSheet.exists({ category: category._id, submissionCount: { $gt: 0 } }),
    TabulationResult.exists({ category: category._id }),
  ]);
  if (submitted || results) throw ApiError.conflict('This category already has submitted scores or results and cannot be deleted.', 'HAS_RECORDS');
  await Promise.all([
    Criterion.deleteMany({ category: category._id }),
    ScoreSheet.deleteMany({ category: category._id }),
    ScoringConfiguration.deleteMany({ category: category._id }),
    EventAssignment.updateMany({ event: category.event }, { $pull: { categories: category._id } }),
  ]);
  await category.deleteOne();
  await audit(req, { action: 'category.deleted', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: category.event, before: { name: category.name } });
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id), deleted: true });
  res.json({ success: true });
});

export const setCategoryContestants = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  assertUnlocked(category);
  const { contestantIds } = parse(z.object({ contestantIds: z.array(objectId).max(500) }), req.body);
  const unique = [...new Set(contestantIds)];
  const contestants = await Contestant.find({ _id: { $in: unique }, event: category.event });
  if (contestants.length !== unique.length) throw ApiError.badRequest('One or more contestants do not belong to this event.');
  if (!event.settings.allowMultiCategoryContestants) {
    const elsewhere = await Category.find({ event: category.event, _id: { $ne: category._id }, contestants: { $in: unique } }, 'name contestants');
    if (elsewhere.length) {
      throw ApiError.conflict('This event does not allow contestants in multiple categories. Remove them from their other category first.', 'MULTI_CATEGORY');
    }
  }
  const before = category.contestants.map(String);
  category.contestants = unique;
  await category.save();
  // Drop unsubmitted drafts for removed contestants
  await ScoreSheet.deleteMany({ category: category._id, contestant: { $nin: unique }, submissionCount: 0 });
  await audit(req, { action: 'category.contestants_changed', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: category.event, before: { contestants: before }, after: { contestants: unique } });
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id) });
  res.json({ success: true, category });
});

export const setCategoryJudges = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  assertUnlocked(category);
  const { judgeIds } = parse(z.object({ judgeIds: z.array(objectId).max(100) }), req.body);
  const wanted = new Set(judgeIds.map(String));
  const assignments = await EventAssignment.find({ event: category.event, role: ROLES.JUDGE });
  const unknown = [...wanted].filter((id) => !assignments.some((a) => String(a.user) === id));
  if (unknown.length) throw ApiError.badRequest('Add the judge to the event (Judges & Staff) before assigning categories.');
  const before = assignments.filter((a) => a.categories.some((c) => String(c) === String(category._id))).map((a) => String(a.user));
  for (const a of assignments) {
    const has = a.categories.some((c) => String(c) === String(category._id));
    const should = wanted.has(String(a.user));
    if (has && !should) a.categories = a.categories.filter((c) => String(c) !== String(category._id));
    else if (!has && should) a.categories.push(category._id);
    else continue;
    await a.save();
  }
  await ScoreSheet.deleteMany({ category: category._id, judge: { $nin: judgeIds }, submissionCount: 0 });
  await audit(req, { action: 'assignment.category_judges_changed', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: category.event, before: { judges: before }, after: { judges: [...wanted] } });
  emitToEvent(category.event, 'assignments:updated');
  res.json({ success: true, judges: await judgesForCategory(category) });
});

export const configCheck = asyncHandler(async (req, res) => {
  const { category } = await loadCategory(req, 'review');
  const check = await checkConfiguration(category);
  res.json({ success: true, ok: check.ok, errors: check.errors, warnings: check.warnings });
});

export const lockCategory = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  const result = await lockConfiguration(req, category);
  res.json({ success: true, ...result });
});

export const reopenCategoryConfig = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) }), req.body);
  const result = await reopenConfiguration(req, category, reason);
  res.json({ success: true, ...result });
});

export const setScoringOpen = (open) =>
  asyncHandler(async (req, res) => {
    const { category, event } = await loadCategory(req, 'manage');
    assertNotArchived(event);
    if (!category.configLocked) throw ApiError.conflict('Lock the configuration (open scoring) first.');
    if (open) {
      const locking = await TabulationResult.findOne({ category: category._id, scope: 'category', status: { $in: ['for_approval', 'approved', 'published'] } });
      if (locking) throw ApiError.conflict(`Result v${locking.version} is ${locking.status.replace('_', ' ')}. Return or unpublish it first.`, 'RESULT_LOCKED');
    }
    const before = category.status;
    category.status = open ? 'scoring' : 'closed';
    await category.save();
    await audit(req, { action: open ? 'category.scoring_reopened' : 'category.scoring_closed', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: category.event, before: { status: before }, after: { status: category.status } });
    emitToEvent(category.event, 'category:updated', { categoryId: String(category._id), status: category.status });
    res.json({ success: true, category });
  });

export const copyCriteria = asyncHandler(async (req, res) => {
  const { category, event } = await loadCategory(req, 'manage');
  assertNotArchived(event);
  assertUnlocked(category);
  const { fromCategory } = parse(z.object({ fromCategory: objectId }), req.body);
  const source = await Category.findById(fromCategory);
  if (!source) throw ApiError.notFound('Source category not found.');
  await requireEventAccess(req.user, source.event, 'manage');
  const items = await Criterion.find({ category: source._id, isActive: true }).sort({ order: 1 });
  if (!items.length) throw ApiError.badRequest('The source category has no active criteria.');
  const offset = await Criterion.countDocuments({ category: category._id });
  const created = await Criterion.insertMany(
    items.map((c, i) => ({ event: category.event, category: category._id, name: c.name, description: c.description, weight: c.weight, minScore: c.minScore, maxScore: c.maxScore, decimalPlaces: c.decimalPlaces, order: offset + i + 1, createdBy: req.user._id }))
  );
  await audit(req, { action: 'criteria.copied', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: category.event, after: { from: source.name, criteria: created.map((c) => `${c.name} (${c.weight}%)`) } });
  res.status(201).json({ success: true, items: created });
});
