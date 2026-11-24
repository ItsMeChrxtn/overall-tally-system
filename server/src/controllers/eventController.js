import { z } from 'zod';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Criterion from '../models/Criterion.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ScoringConfiguration from '../models/ScoringConfiguration.js';
import TabulationResult from '../models/TabulationResult.js';
import ResultApproval from '../models/ResultApproval.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escapeRegex, optionalDate, parse } from '../utils/validation.js';
import { accessibleEventIds, assertNotArchived, requireEventAccess, resolveEventAccess } from '../services/accessService.js';
import { audit, diff } from '../services/auditService.js';
import { removeUpload } from '../middleware/upload.js';
import { EVENT_STATUSES, EVENT_TYPES, OVERALL_METHODS, ROLES } from '../constants/index.js';

const EDITABLE = ['name', 'description', 'eventType', 'venue', 'eventDate', 'startDate', 'endDate', 'organizer', 'settings', 'overall'];

const eventBody = z.object({
  name: z.string().trim().min(3, 'Event name must have at least 3 characters').max(160),
  description: z.string().trim().max(4000).optional(),
  eventType: z.enum(EVENT_TYPES).default('other'),
  venue: z.string().trim().max(200).optional(),
  organizer: z.string().trim().max(160).optional(),
  eventDate: optionalDate,
  startDate: optionalDate,
  endDate: optionalDate,
  status: z.enum(['draft', 'upcoming', 'active']).optional(),
  settings: z
    .object({
      allowMultiCategoryContestants: z.boolean().optional(),
      judgesCanViewOwnSubmitted: z.boolean().optional(),
      allowIncompleteRanking: z.boolean().optional(),
      publicShowScores: z.boolean().optional(),
    })
    .optional(),
  overall: z
    .object({
      enabled: z.boolean().optional(),
      title: z.string().trim().min(1).max(120).optional(),
      method: z.enum(OVERALL_METHODS).optional(),
      decimalPlaces: z.number().int().min(0).max(4).optional(),
    })
    .optional(),
  adminIds: z.array(z.string()).optional(),
});

function checkDates(d) {
  if (d.startDate && d.endDate && d.endDate < d.startDate) throw ApiError.badRequest('End date cannot be before the start date.');
}

async function eventCounts(eventIds) {
  const match = { event: { $in: eventIds } };
  const group = (Model, extra = {}) =>
    Model.aggregate([{ $match: { ...match, ...extra } }, { $group: { _id: '$event', n: { $sum: 1 } } }]).then((rows) => Object.fromEntries(rows.map((r) => [String(r._id), r.n])));
  const [categories, contestants, judges, submitted, sheets] = await Promise.all([
    group(Category),
    group(Contestant, { status: 'active' }),
    group(EventAssignment, { role: ROLES.JUDGE }),
    group(ScoreSheet, { status: 'submitted' }),
    group(ScoreSheet),
  ]);
  return { categories, contestants, judges, submitted, sheets };
}

export const listEvents = asyncHandler(async (req, res) => {
  const ids = await accessibleEventIds(req.user);
  const filter = ids === null ? {} : { _id: { $in: ids } };
  const { status, q, type } = req.query;
  if (status === 'active_only') filter.status = { $nin: ['archived', 'completed'] };
  else if (status && EVENT_STATUSES.includes(status)) filter.status = status;
  else if (!status) filter.status = { $ne: 'archived' };
  if (type && EVENT_TYPES.includes(type)) filter.eventType = type;
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');

  const events = await Event.find(filter).sort({ eventDate: -1, createdAt: -1 }).limit(500).lean();
  const counts = await eventCounts(events.map((e) => e._id));
  const myAssignments = await EventAssignment.find({ user: req.user._id, event: { $in: events.map((e) => e._id) } }).lean();
  const items = events.map((e) => {
    const key = String(e._id);
    return {
      ...e,
      counts: {
        categories: counts.categories[key] || 0,
        contestants: counts.contestants[key] || 0,
        judges: counts.judges[key] || 0,
        submittedSheets: counts.submitted[key] || 0,
        sheets: counts.sheets[key] || 0,
      },
      myRoles: myAssignments.filter((a) => String(a.event) === key).map((a) => a.role),
    };
  });
  res.json({ success: true, items });
});

export const getEvent = asyncHandler(async (req, res) => {
  const access = await resolveEventAccess(req.user, req.params.id);
  if (!access.can.review && !access.can.judge) throw ApiError.forbidden('You are not authorized for this event.');
  const { event } = access;
  const counts = await eventCounts([event._id]);
  const key = String(event._id);
  const admins = await EventAssignment.find({ event: event._id, role: ROLES.EVENT_ADMIN }).populate('user', 'name email');
  await event.populate('createdBy', 'name email');
  res.json({
    success: true,
    event,
    admins: admins.filter((a) => a.user).map((a) => a.user),
    can: access.can,
    counts: {
      categories: counts.categories[key] || 0,
      contestants: counts.contestants[key] || 0,
      judges: counts.judges[key] || 0,
      submittedSheets: counts.submitted[key] || 0,
      sheets: counts.sheets[key] || 0,
    },
  });
});

async function setEventAdmins(req, event, adminIds) {
  const users = await mongoose.model('User').find({ _id: { $in: adminIds }, role: ROLES.EVENT_ADMIN, status: 'active' });
  if (users.length !== adminIds.length) throw ApiError.badRequest('Every assigned administrator must be an active Event Admin account.');
  const current = await EventAssignment.find({ event: event._id, role: ROLES.EVENT_ADMIN });
  const keep = new Set(adminIds.map(String));
  const removed = current.filter((a) => !keep.has(String(a.user)));
  const existing = new Set(current.map((a) => String(a.user)));
  const added = users.filter((u) => !existing.has(String(u._id)));
  await EventAssignment.deleteMany({ _id: { $in: removed.map((a) => a._id) } });
  if (added.length) await EventAssignment.insertMany(added.map((u) => ({ event: event._id, user: u._id, role: ROLES.EVENT_ADMIN, assignedBy: req.user._id })));
  if (removed.length || added.length) {
    await audit(req, {
      action: 'assignment.event_admins_changed',
      entityType: 'Event',
      entityId: event._id,
      entityLabel: event.name,
      event: event._id,
      before: { admins: current.map((a) => String(a.user)) },
      after: { admins: adminIds },
    });
  }
}

export const createEvent = asyncHandler(async (req, res) => {
  const data = parse(eventBody, req.body);
  checkDates(data);
  const { adminIds, ...fields } = data;
  const event = await Event.create({ ...fields, status: fields.status || 'draft', createdBy: req.user._id });
  if (req.user.role === ROLES.EVENT_ADMIN) {
    await EventAssignment.create({ event: event._id, user: req.user._id, role: ROLES.EVENT_ADMIN, assignedBy: req.user._id });
  } else if (adminIds?.length) {
    await setEventAdmins(req, event, adminIds);
  }
  await audit(req, { action: 'event.created', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, after: fields });
  res.status(201).json({ success: true, event });
});

export const updateEvent = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.id, 'manage');
  assertNotArchived(event);
  const data = parse(eventBody.partial().omit({ status: true }), req.body);
  const { adminIds, ...fields } = data;
  const before = event.toObject();
  for (const k of EDITABLE) {
    if (fields[k] === undefined) continue;
    if (k === 'settings' || k === 'overall') Object.assign(event[k], fields[k]);
    else event[k] = fields[k];
  }
  checkDates(event);
  await event.save();
  if (adminIds) {
    if (req.user.role !== ROLES.SUPER_ADMIN) throw ApiError.forbidden('Only a Super Admin can assign Event Admins.');
    await setEventAdmins(req, event, adminIds);
  }
  const d = diff(before, event.toObject(), EDITABLE);
  if (d.changed) await audit(req, { action: 'event.updated', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, before: d.before, after: d.after });
  res.json({ success: true, event });
});

export const setEventStatus = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.id, 'manage');
  const { status } = parse(z.object({ status: z.enum(EVENT_STATUSES.filter((s) => s !== 'archived')) }), req.body);
  assertNotArchived(event);
  if (['published', 'completed'].includes(status)) {
    const published = await TabulationResult.exists({ event: event._id, status: 'published' });
    if (!published) throw ApiError.badRequest(`An event can only be marked ${status} after at least one result is published.`);
  }
  const before = event.status;
  event.status = status;
  if (status === 'completed') event.completedAt = new Date();
  await event.save();
  await audit(req, { action: 'event.status_changed', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, before: { status: before }, after: { status } });
  res.json({ success: true, event });
});

export const archiveEvent = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.id, 'manage');
  if (event.status === 'archived') throw ApiError.conflict('Event is already archived.');
  const pending = await TabulationResult.exists({ event: event._id, status: { $in: ['for_approval'] } });
  if (pending) throw ApiError.conflict('Resolve results awaiting approval before archiving.');
  const before = event.status;
  event.status = 'archived';
  event.archivedAt = new Date();
  await event.save();
  await audit(req, { action: 'event.archived', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, before: { status: before }, after: { status: 'archived' } });
  res.json({ success: true, event });
});

export const restoreEvent = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.SUPER_ADMIN) throw ApiError.forbidden('Only a Super Admin can restore archived events.');
  const event = await Event.findById(req.params.id);
  if (!event) throw ApiError.notFound('Event not found.');
  if (event.status !== 'archived') throw ApiError.conflict('Event is not archived.');
  const published = await TabulationResult.exists({ event: event._id, status: 'published' });
  event.status = event.completedAt ? 'completed' : published ? 'published' : 'draft';
  event.archivedAt = undefined;
  await event.save();
  await audit(req, { action: 'event.restored', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, before: { status: 'archived' }, after: { status: event.status } });
  res.json({ success: true, event });
});

export const deleteEvent = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.SUPER_ADMIN) throw ApiError.forbidden('Only a Super Admin can delete events.');
  const event = await Event.findById(req.params.id);
  if (!event) throw ApiError.notFound('Event not found.');
  const [submitted, results] = await Promise.all([
    ScoreSheet.exists({ event: event._id, submissionCount: { $gt: 0 } }),
    TabulationResult.exists({ event: event._id }),
  ]);
  if (submitted || results) {
    throw ApiError.conflict('This event already has submitted scores or results. Archive it instead to preserve the record.', 'HAS_RECORDS');
  }
  const contestants = await Contestant.find({ event: event._id }, 'photo');
  await Promise.all([
    Category.deleteMany({ event: event._id }),
    Contestant.deleteMany({ event: event._id }),
    Criterion.deleteMany({ event: event._id }),
    EventAssignment.deleteMany({ event: event._id }),
    ScoreSheet.deleteMany({ event: event._id }),
    ScoringConfiguration.deleteMany({ event: event._id }),
    ResultApproval.deleteMany({ event: event._id }),
  ]);
  contestants.forEach((c) => removeUpload(c.photo));
  removeUpload(event.coverImage);
  await event.deleteOne();
  await audit(req, { action: 'event.deleted', entityType: 'Event', entityId: event._id, entityLabel: event.name, before: { name: event.name, status: event.status } });
  res.json({ success: true });
});

export const uploadCover = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.id, 'manage');
  assertNotArchived(event);
  if (!req.file) throw ApiError.badRequest('Choose an image to upload.');
  const old = event.coverImage;
  event.coverImage = `/uploads/events/${req.file.filename}`;
  await event.save();
  removeUpload(old);
  await audit(req, { action: 'event.cover_updated', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id });
  res.json({ success: true, event });
});
