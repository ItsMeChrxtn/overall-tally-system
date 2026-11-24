import { z } from 'zod';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import EventAssignment from '../models/EventAssignment.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escapeRegex, parse, passwordSchema } from '../utils/validation.js';
import { audit, diff } from '../services/auditService.js';
import { ROLES, ROLE_LIST } from '../constants/index.js';

/** Event Admins may only create/manage judge and tabulator accounts. */
const MANAGEABLE_BY_EVENT_ADMIN = [ROLES.JUDGE, ROLES.TABULATOR];

function assertCanManageRole(actor, role) {
  if (actor.role === ROLES.SUPER_ADMIN) return;
  if (actor.role === ROLES.EVENT_ADMIN && MANAGEABLE_BY_EVENT_ADMIN.includes(role)) return;
  throw ApiError.forbidden('You cannot manage accounts with this role.');
}

export const listUsers = asyncHandler(async (req, res) => {
  const { role, status, q } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
  const filter = {};
  if (role && ROLE_LIST.includes(role)) filter.role = role;
  if (status && ['active', 'inactive'].includes(status)) filter.status = status;
  if (req.user.role === ROLES.EVENT_ADMIN) filter.role = filter.role && MANAGEABLE_BY_EVENT_ADMIN.includes(filter.role) ? filter.role : { $in: MANAGEABLE_BY_EVENT_ADMIN };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { affiliation: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, items: items.map((u) => u.toSafeObject()), total, page, pages: Math.ceil(total / limit) || 1 });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  assertCanManageRole(req.user, user.role);
  const assignments = await EventAssignment.find({ user: user._id }).populate('event', 'name status eventDate').populate('categories', 'name');
  res.json({ success: true, user: user.toSafeObject(), assignments });
});

export const createUser = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const data = parse(
    z.object({
      name: z.string().trim().min(2, 'Name is required').max(120),
      email: z.string().trim().toLowerCase().email('Enter a valid email'),
      role: z.enum(ROLE_LIST),
      password: passwordSchema(settings.passwordMinLength),
      title: z.string().trim().max(120).optional(),
      affiliation: z.string().trim().max(160).optional(),
      phone: z.string().trim().max(40).optional(),
      mustChangePassword: z.boolean().optional().default(true),
    }),
    req.body
  );
  assertCanManageRole(req.user, data.role);
  if (await User.exists({ email: data.email })) throw ApiError.conflict('An account with this email already exists.', 'DUPLICATE');
  const user = new User({ ...data, createdBy: req.user._id });
  await user.setPassword(data.password);
  await user.save();
  await audit(req, { action: 'user.created', entityType: 'User', entityId: user._id, entityLabel: user.email, after: { name: user.name, email: user.email, role: user.role } });
  res.status(201).json({ success: true, user: user.toSafeObject() });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  assertCanManageRole(req.user, user.role);
  const data = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      email: z.string().trim().toLowerCase().email().optional(),
      role: z.enum(ROLE_LIST).optional(),
      title: z.string().trim().max(120).optional(),
      affiliation: z.string().trim().max(160).optional(),
      phone: z.string().trim().max(40).optional(),
    }),
    req.body
  );
  if (data.role && data.role !== user.role) {
    assertCanManageRole(req.user, data.role);
    if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('You cannot change your own role.');
    if (await EventAssignment.exists({ user: user._id })) {
      throw ApiError.conflict('Remove this user from their event assignments before changing their role.');
    }
  }
  if (data.email && data.email !== user.email && (await User.exists({ email: data.email }))) throw ApiError.conflict('Email already in use.');
  const before = user.toSafeObject();
  Object.assign(user, data);
  if (data.role && data.role !== before.role) user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  const d = diff(before, user.toSafeObject(), ['name', 'email', 'role', 'title', 'affiliation', 'phone']);
  if (d.changed) await audit(req, { action: 'user.updated', entityType: 'User', entityId: user._id, entityLabel: user.email, before: d.before, after: d.after });
  res.json({ success: true, user: user.toSafeObject() });
});

export const setUserStatus = asyncHandler(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['active', 'inactive']) }), req.body);
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw ApiError.notFound('User not found.');
  assertCanManageRole(req.user, user.role);
  if (String(user._id) === String(req.user._id)) throw ApiError.badRequest('You cannot change your own account status.');
  if (user.role === ROLES.SUPER_ADMIN && status === 'inactive') {
    const others = await User.countDocuments({ role: ROLES.SUPER_ADMIN, status: 'active', _id: { $ne: user._id } });
    if (!others) throw ApiError.badRequest('At least one active Super Admin is required.');
  }
  const before = user.status;
  user.status = status;
  if (status === 'inactive') user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await audit(req, { action: status === 'active' ? 'user.activated' : 'user.deactivated', entityType: 'User', entityId: user._id, entityLabel: user.email, before: { status: before }, after: { status } });
  res.json({ success: true, user: user.toSafeObject() });
});

export const adminResetPassword = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const { password } = parse(z.object({ password: passwordSchema(settings.passwordMinLength) }), req.body);
  const user = await User.findById(req.params.id).select('+tokenVersion');
  if (!user) throw ApiError.notFound('User not found.');
  assertCanManageRole(req.user, user.role);
  await user.setPassword(password);
  user.mustChangePassword = true;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await audit(req, { action: 'user.password_reset_by_admin', entityType: 'User', entityId: user._id, entityLabel: user.email });
  res.json({ success: true, message: 'Temporary password set. The user must change it at next sign-in.' });
});
