import { z } from 'zod';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectId, parse } from '../utils/validation.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { audit, diff } from '../services/auditService.js';
import { emitToEvent } from '../services/realtime.js';
import { removeUpload } from '../middleware/upload.js';
import { CONTESTANT_STATUS } from '../constants/index.js';

const FIELDS = ['number', 'name', 'isTeam', 'teamName', 'members', 'representing', 'description', 'status'];

const body = z.object({
  number: z.number({ invalid_type_error: 'Contestant number is required' }).int().min(1, 'Number must be 1 or higher').max(99999),
  name: z.string().trim().min(1, 'Name is required').max(160),
  isTeam: z.boolean().optional().default(false),
  teamName: z.string().trim().max(160).optional(),
  members: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  representing: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(CONTESTANT_STATUS).optional(),
  categories: z.array(objectId).optional(),
});

async function syncCategories(req, event, contestant, categoryIds) {
  const all = await Category.find({ event: event._id });
  const wanted = new Set(categoryIds.map(String));
  if ([...wanted].some((id) => !all.some((c) => String(c._id) === id))) throw ApiError.badRequest('One or more categories do not belong to this event.');
  if (!event.settings.allowMultiCategoryContestants && wanted.size > 1) throw ApiError.badRequest('This event allows each contestant in only one category.');
  const changes = [];
  for (const c of all) {
    const has = c.contestants.some((x) => String(x) === String(contestant._id));
    const should = wanted.has(String(c._id));
    if (has === should) continue;
    if (c.configLocked) throw ApiError.conflict(`"${c.name}" is locked for scoring; reopen its configuration to change contestants.`, 'CONFIG_LOCKED');
    changes.push({ c, should });
  }
  for (const { c, should } of changes) {
    if (should) c.contestants.push(contestant._id);
    else c.contestants = c.contestants.filter((x) => String(x) !== String(contestant._id));
    await c.save();
  }
  return changes.length > 0;
}

async function assertNotInLockedCategory(contestant, what) {
  const locked = await Category.findOne({ contestants: contestant._id, configLocked: true }, 'name');
  if (locked) throw ApiError.conflict(`Cannot change ${what} while "${locked.name}" is locked for scoring. Reopen its configuration first.`, 'CONFIG_LOCKED');
}

export const listContestants = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'review');
  const [items, categories] = await Promise.all([
    Contestant.find({ event: event._id }).sort({ number: 1 }).lean(),
    Category.find({ event: event._id }, 'name contestants').lean(),
  ]);
  res.json({
    success: true,
    items: items.map((c) => ({
      ...c,
      categories: categories.filter((k) => k.contestants.some((x) => String(x) === String(c._id))).map((k) => ({ _id: k._id, name: k.name })),
    })),
  });
});

export const createContestant = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'manage');
  assertNotArchived(event);
  const { categories, ...data } = parse(body, req.body);
  if (await Contestant.exists({ event: event._id, number: data.number })) throw ApiError.conflict(`Contestant number ${data.number} is already used in this event.`, 'DUPLICATE');
  if (data.isTeam && !data.teamName) data.teamName = data.name;
  const contestant = await Contestant.create({ ...data, event: event._id, createdBy: req.user._id });
  if (categories?.length) {
    try {
      await syncCategories(req, event, contestant, categories);
    } catch (err) {
      await contestant.deleteOne();
      throw err;
    }
  }
  await audit(req, { action: 'contestant.created', entityType: 'Contestant', entityId: contestant._id, entityLabel: `#${contestant.number} ${contestant.name}`, event: event._id, after: { ...data, categories } });
  emitToEvent(event._id, 'contestants:updated');
  res.status(201).json({ success: true, contestant });
});

export const updateContestant = asyncHandler(async (req, res) => {
  const contestant = await Contestant.findById(req.params.id);
  if (!contestant) throw ApiError.notFound('Contestant not found.');
  const { event } = await requireEventAccess(req.user, contestant.event, 'manage');
  assertNotArchived(event);
  const { categories, ...data } = parse(body.partial(), req.body);
  if (data.number !== undefined && data.number !== contestant.number) {
    await assertNotInLockedCategory(contestant, 'the contestant number');
    if (await Contestant.exists({ event: event._id, number: data.number, _id: { $ne: contestant._id } })) throw ApiError.conflict(`Contestant number ${data.number} is already used.`);
  }
  if (data.status && data.status !== contestant.status) await assertNotInLockedCategory(contestant, 'participation status');
  const before = contestant.toObject();
  for (const f of FIELDS) if (data[f] !== undefined) contestant[f] = data[f];
  await contestant.save();
  if (categories) await syncCategories(req, event, contestant, categories);
  const d = diff(before, contestant.toObject(), FIELDS);
  if (d.changed || categories) {
    await audit(req, { action: 'contestant.updated', entityType: 'Contestant', entityId: contestant._id, entityLabel: `#${contestant.number} ${contestant.name}`, event: event._id, before: d.before, after: { ...d.after, ...(categories ? { categories } : {}) } });
  }
  emitToEvent(event._id, 'contestants:updated');
  res.json({ success: true, contestant });
});

export const deleteContestant = asyncHandler(async (req, res) => {
  const contestant = await Contestant.findById(req.params.id);
  if (!contestant) throw ApiError.notFound('Contestant not found.');
  const { event } = await requireEventAccess(req.user, contestant.event, 'manage');
  assertNotArchived(event);
  if (await ScoreSheet.exists({ contestant: contestant._id, submissionCount: { $gt: 0 } })) {
    throw ApiError.conflict('This contestant already has submitted scores. Set the status to Withdrawn instead of deleting.', 'HAS_RECORDS');
  }
  await assertNotInLockedCategory(contestant, 'contestants');
  await Category.updateMany({ event: event._id }, { $pull: { contestants: contestant._id } });
  await ScoreSheet.deleteMany({ contestant: contestant._id });
  await contestant.deleteOne();
  removeUpload(contestant.photo);
  await audit(req, { action: 'contestant.deleted', entityType: 'Contestant', entityId: contestant._id, entityLabel: `#${contestant.number} ${contestant.name}`, event: event._id, before: contestant.toObject() });
  emitToEvent(event._id, 'contestants:updated');
  res.json({ success: true });
});

export const uploadPhoto = asyncHandler(async (req, res) => {
  const contestant = await Contestant.findById(req.params.id);
  if (!contestant) throw ApiError.notFound('Contestant not found.');
  const { event } = await requireEventAccess(req.user, contestant.event, 'manage');
  assertNotArchived(event);
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');
  const old = contestant.photo;
  contestant.photo = `/uploads/contestants/${req.file.filename}`;
  await contestant.save();
  removeUpload(old);
  await audit(req, { action: 'contestant.photo_updated', entityType: 'Contestant', entityId: contestant._id, entityLabel: `#${contestant.number} ${contestant.name}`, event: event._id });
  res.json({ success: true, contestant });
});
