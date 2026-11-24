import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';
import Notification from '../models/Notification.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escapeRegex } from '../utils/validation.js';
import { accessibleEventIds, requireEventAccess } from '../services/accessService.js';
import { ROLES } from '../constants/index.js';

// ------------------------------------------------------------ notifications
export const listNotifications = asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  res.json({ success: true, items, unread });
});

export const markNotificationRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: true }, { new: true });
  if (!n) throw ApiError.notFound('Notification not found.');
  res.json({ success: true, notification: n });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ success: true });
});

// ------------------------------------------------------------ audit logs (read-only API)
export async function buildAuditFilter(req) {
  const { event, action, entityType, user, q, from, to } = req.query;
  const filter = {};
  if (req.user.role === ROLES.SUPER_ADMIN) {
    if (event && mongoose.isValidObjectId(event)) filter.event = event;
  } else {
    // Event admins only see logs of events they manage
    if (event) {
      await requireEventAccess(req.user, event, 'manage');
      filter.event = event;
    } else {
      const ids = await accessibleEventIds(req.user);
      filter.event = { $in: ids };
    }
  }
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  if (entityType) filter.entityType = entityType;
  if (user && mongoose.isValidObjectId(user)) filter.user = user;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ userName: rx }, { entityLabel: rx }, { action: rx }];
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(new Date(to).getTime() + 86399999);
  }
  return filter;
}

export const listAuditLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const filter = await buildAuditFilter(req);
  const [items, total, actions] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('event', 'name').lean(),
    AuditLog.countDocuments(filter),
    AuditLog.distinct('action'),
  ]);
  res.json({ success: true, items, total, page, pages: Math.ceil(total / limit) || 1, actions: actions.sort() });
});
