import { z } from 'zod';
import Category from '../models/Category.js';
import Criterion from '../models/Criterion.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectId, parse } from '../utils/validation.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { audit, diff } from '../services/auditService.js';
import { emitToEvent } from '../services/realtime.js';

const FIELDS = ['name', 'description', 'weight', 'minScore', 'maxScore', 'decimalPlaces', 'order', 'isActive'];

const body = z.object({
  name: z.string().trim().min(2, 'Criterion name is required').max(120),
  description: z.string().trim().max(1000).optional(),
  weight: z.number({ invalid_type_error: 'Weight must be a number' }).min(0, 'Weight cannot be negative').max(100, 'Weight cannot exceed 100%'),
  minScore: z.number().min(0, 'Minimum score cannot be negative').max(10000).default(0),
  maxScore: z.number().positive('Maximum score must be greater than 0').max(10000),
  decimalPlaces: z.number().int().min(0).max(4).default(2),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

async function loadCategoryForEdit(req, categoryId) {
  const category = await Category.findById(categoryId);
  if (!category) throw ApiError.notFound('Category not found.');
  const { event } = await requireEventAccess(req.user, category.event, 'manage');
  assertNotArchived(event);
  if (category.configLocked) {
    throw ApiError.conflict('Criteria cannot change after scoring has started. Formally reopen the configuration first.', 'CONFIG_LOCKED');
  }
  return category;
}

/** Weighted methods need weights that total 100%; reject edits that overshoot it. */
async function assertWeightBudget(category, excludeId, newWeight, active) {
  if (!['weighted', 'custom'].includes(category.scoringMethod) || !active) return;
  const others = await Criterion.find({ category: category._id, isActive: true, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }, 'weight');
  const total = others.reduce((a, c) => a + c.weight, 0) + newWeight;
  if (total > 100 + 1e-9) throw ApiError.badRequest(`Weights would total ${+total.toFixed(4)}%. The total must not exceed 100%.`, 'WEIGHT_EXCEEDED');
}

export const listCriteria = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.categoryId);
  if (!category) throw ApiError.notFound('Category not found.');
  await requireEventAccess(req.user, category.event, 'review');
  const items = await Criterion.find({ category: category._id }).sort({ order: 1, createdAt: 1 });
  res.json({ success: true, items, totalWeight: +items.filter((c) => c.isActive).reduce((a, c) => a + c.weight, 0).toFixed(4) });
});

export const createCriterion = asyncHandler(async (req, res) => {
  const category = await loadCategoryForEdit(req, req.params.categoryId);
  const data = parse(body, req.body);
  if (data.maxScore <= data.minScore) throw ApiError.badRequest('Maximum score must be greater than the minimum score.');
  await assertWeightBudget(category, null, data.weight, data.isActive !== false);
  const order = data.order ?? (await Criterion.countDocuments({ category: category._id })) + 1;
  const criterion = await Criterion.create({ ...data, order, event: category.event, category: category._id, createdBy: req.user._id });
  await audit(req, { action: 'criteria.created', entityType: 'Criterion', entityId: criterion._id, entityLabel: `${category.name} › ${criterion.name}`, event: category.event, after: data });
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id) });
  res.status(201).json({ success: true, criterion });
});

export const updateCriterion = asyncHandler(async (req, res) => {
  const criterion = await Criterion.findById(req.params.id);
  if (!criterion) throw ApiError.notFound('Criterion not found.');
  const category = await loadCategoryForEdit(req, criterion.category);
  const data = parse(body.partial(), req.body);
  const next = { ...criterion.toObject(), ...data };
  if (next.maxScore <= next.minScore) throw ApiError.badRequest('Maximum score must be greater than the minimum score.');
  await assertWeightBudget(category, criterion._id, next.weight, next.isActive);
  const before = criterion.toObject();
  for (const f of FIELDS) if (data[f] !== undefined) criterion[f] = data[f];
  await criterion.save();
  const d = diff(before, criterion.toObject(), FIELDS);
  if (d.changed) await audit(req, { action: 'criteria.updated', entityType: 'Criterion', entityId: criterion._id, entityLabel: `${category.name} › ${criterion.name}`, event: category.event, before: d.before, after: d.after });
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id) });
  res.json({ success: true, criterion });
});

export const deleteCriterion = asyncHandler(async (req, res) => {
  const criterion = await Criterion.findById(req.params.id);
  if (!criterion) throw ApiError.notFound('Criterion not found.');
  const category = await loadCategoryForEdit(req, criterion.category);
  // Keep criteria that appear in historical score sheets; just disable them
  const referenced = await ScoreSheet.exists({ category: category._id, 'scores.criterion': criterion._id, submissionCount: { $gt: 0 } });
  if (referenced) {
    criterion.isActive = false;
    await criterion.save();
    await audit(req, { action: 'criteria.disabled', entityType: 'Criterion', entityId: criterion._id, entityLabel: `${category.name} › ${criterion.name}`, event: category.event, before: { isActive: true }, after: { isActive: false }, meta: { reason: 'Referenced by historical score sheets' } });
    return res.json({ success: true, disabled: true, message: 'This criterion has historical scores, so it was disabled instead of deleted.' });
  }
  await criterion.deleteOne();
  await ScoreSheet.updateMany({ category: category._id }, { $pull: { scores: { criterion: criterion._id } } });
  await audit(req, { action: 'criteria.deleted', entityType: 'Criterion', entityId: criterion._id, entityLabel: `${category.name} › ${criterion.name}`, event: category.event, before: criterion.toObject() });
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id) });
  res.json({ success: true });
});

export const reorderCriteria = asyncHandler(async (req, res) => {
  const category = await loadCategoryForEdit(req, req.params.categoryId);
  const { ids } = parse(z.object({ ids: z.array(objectId).min(1) }), req.body);
  const items = await Criterion.find({ category: category._id });
  if (items.length !== ids.length || !items.every((c) => ids.includes(String(c._id)))) throw ApiError.badRequest('Send every criterion of the category exactly once.');
  await Promise.all(ids.map((id, i) => Criterion.updateOne({ _id: id }, { order: i + 1 })));
  await audit(req, { action: 'criteria.reordered', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: category.event, after: { order: ids } });
  res.json({ success: true, items: await Criterion.find({ category: category._id }).sort({ order: 1 }) });
});
