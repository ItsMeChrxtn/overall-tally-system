import { randomBytes } from 'crypto';
import { z } from 'zod';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import Category from '../models/Category.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectId, parse, passwordSchema } from '../utils/validation.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { audit } from '../services/auditService.js';
import { notify } from '../services/notificationService.js';
import { emitToEvent } from '../services/realtime.js';
import { ASSIGNMENT_ROLES, ROLES } from '../constants/index.js';

async function assertCategoriesEditable(eventId, categoryIds, verb) {
  if (!categoryIds.length) return;
  const locked = await Category.find({ _id: { $in: categoryIds }, event: eventId, configLocked: true }, 'name');
  if (locked.length) {
    throw ApiError.conflict(
      `Cannot ${verb} judges for ${locked.map((c) => `"${c.name}"`).join(', ')}: scoring is locked. Reopen the configuration first.`,
      'CONFIG_LOCKED'
    );
  }
}

export const listAssignments = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'review');
  const items = await EventAssignment.find({ event: event._id })
    .populate('user', 'name email role status title affiliation lastLoginAt loginEnabled')
    .populate('categories', 'name')
    .sort({ role: 1, order: 1, createdAt: 1 });

  // Judge progress (submitted / total sheets expected)
  const categories = await Category.find({ event: event._id }, 'contestants configLocked');
  const sheetCounts = await ScoreSheet.aggregate([
    { $match: { event: event._id } },
    { $group: { _id: { judge: '$judge', status: '$status' }, n: { $sum: 1 } } },
  ]);
  const progress = {};
  for (const a of items.filter((x) => x.role === ROLES.JUDGE && x.user)) {
    const expected = a.categories.reduce((sum, c) => sum + (categories.find((k) => String(k._id) === String(c._id))?.contestants.length || 0), 0);
    const submitted = sheetCounts.find((s) => String(s._id.judge) === String(a.user._id) && s._id.status === 'submitted')?.n || 0;
    progress[String(a._id)] = { expected, submitted };
  }
  res.json({ success: true, items: items.filter((a) => a.user), progress });
});

export const createAssignment = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'manage');
  assertNotArchived(event);
  const data = parse(
    z.object({ user: objectId, role: z.enum(ASSIGNMENT_ROLES), categories: z.array(objectId).optional().default([]), order: z.number().int().min(0).optional() }),
    req.body
  );
  if (data.role === ROLES.EVENT_ADMIN && req.user.role !== ROLES.SUPER_ADMIN) throw ApiError.forbidden('Only a Super Admin can assign Event Admins.');
  const user = await User.findById(data.user);
  if (!user || user.status !== 'active') throw ApiError.badRequest('Select an active user account.');
  if (user.role !== data.role) throw ApiError.badRequest(`${user.name} has the ${user.role.replace('_', ' ')} role and cannot be assigned as ${data.role.replace('_', ' ')}.`);
  if (await EventAssignment.exists({ event: event._id, user: user._id, role: data.role })) throw ApiError.conflict(`${user.name} is already assigned to this event.`);

  let categories = [];
  if (data.role === ROLES.JUDGE) {
    categories = await Category.find({ _id: { $in: data.categories }, event: event._id });
    if (categories.length !== data.categories.length) throw ApiError.badRequest('One or more categories do not belong to this event.');
    await assertCategoriesEditable(event._id, data.categories, 'add');
  }
  const order = data.order ?? (await EventAssignment.countDocuments({ event: event._id, role: data.role })) + 1;
  const assignment = await EventAssignment.create({ event: event._id, user: user._id, role: data.role, categories: categories.map((c) => c._id), order, assignedBy: req.user._id });
  await audit(req, {
    action: 'assignment.created',
    entityType: 'EventAssignment',
    entityId: assignment._id,
    entityLabel: `${user.name} as ${data.role}`,
    event: event._id,
    after: { user: user.name, role: data.role, categories: categories.map((c) => c.name) },
  });
  await notify(user._id, { title: 'New event assignment', message: `You were assigned to "${event.name}" as ${data.role.replace('_', ' ')}.`, link: data.role === ROLES.JUDGE ? '/app/judging' : `/app/events/${event._id}`, event: event._id });
  emitToEvent(event._id, 'assignments:updated');
  await assignment.populate([{ path: 'user', select: 'name email role status title' }, { path: 'categories', select: 'name' }]);
  res.status(201).json({ success: true, assignment });
});

/** Parses optional judge sign-in credentials ({ email, password }); both or neither. */
async function parseJudgeLogin(body) {
  const settings = await Setting.getGlobal();
  const data = parse(
    z.object({
      email: z.string().trim().toLowerCase().email("Enter a valid email for the judge's sign-in").optional().or(z.literal('')),
      password: passwordSchema(settings.passwordMinLength).optional().or(z.literal('')),
    }),
    { email: body?.email, password: body?.password }
  );
  if (!data.email && !data.password) return null;
  if (!data.email) throw ApiError.badRequest('Enter the email the judge will sign in with.');
  if (!data.password) throw ApiError.badRequest('Set a password for the judge.');
  return data;
}

/**
 * Adds a judge to the event in one step. With `email` + `password` the judge gets their own
 * sign-in and scores their assigned categories themselves; without them the judge is
 * name-only (cannot sign in) and the event admin encodes their paper score sheets.
 */
export const createEncodeJudge = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'manage');
  assertNotArchived(event);
  const data = parse(
    z.object({
      name: z.string().trim().min(2, 'Enter the judge\'s name').max(120),
      title: z.string().trim().max(120).optional(),
      affiliation: z.string().trim().max(160).optional(),
      categories: z.array(objectId).optional().default([]),
      order: z.number().int().min(1).optional(),
    }),
    req.body
  );
  const login = await parseJudgeLogin(req.body);
  const categories = await Category.find({ _id: { $in: data.categories }, event: event._id });
  if (categories.length !== data.categories.length) throw ApiError.badRequest('One or more categories do not belong to this event.');
  await assertCategoriesEditable(event._id, data.categories, 'add');
  if (login && (await User.exists({ email: login.email }))) throw ApiError.conflict('An account with this email already exists.', 'DUPLICATE');

  const user = new User({
    name: data.name,
    title: data.title,
    affiliation: data.affiliation,
    // Name-only judges get a placeholder address: unique, never used to sign in or receive mail
    email: login ? login.email : `judge.${randomBytes(6).toString('hex')}@encode.local`,
    role: ROLES.JUDGE,
    loginEnabled: !!login,
    createdBy: req.user._id,
  });
  await user.setPassword(login ? login.password : randomBytes(24).toString('base64url'));
  await user.save();

  const order = data.order ?? (await EventAssignment.countDocuments({ event: event._id, role: ROLES.JUDGE })) + 1;
  const assignment = await EventAssignment.create({ event: event._id, user: user._id, role: ROLES.JUDGE, categories: categories.map((c) => c._id), order, assignedBy: req.user._id });
  await audit(req, {
    action: 'assignment.created',
    entityType: 'EventAssignment',
    entityId: assignment._id,
    entityLabel: `${user.name} as judge${login ? '' : ' (encoded)'}`,
    event: event._id,
    after: { user: user.name, role: ROLES.JUDGE, encodeOnly: !login, ...(login ? { email: login.email } : {}), seat: order, categories: categories.map((c) => c.name) },
  });
  if (login) await notify(user._id, { title: 'New event assignment', message: `You were assigned to judge "${event.name}".`, link: '/app/judging', event: event._id });
  emitToEvent(event._id, 'assignments:updated');
  await assignment.populate([{ path: 'user', select: 'name email role status title loginEnabled' }, { path: 'categories', select: 'name' }]);
  res.status(201).json({ success: true, assignment });
});

/**
 * Gives a judge of this event their own sign-in (or changes it), or turns it off so the
 * event admin encodes their scores instead. Body: { email, password } or { enabled: false }.
 */
export const setJudgeLogin = asyncHandler(async (req, res) => {
  const assignment = await EventAssignment.findById(req.params.id);
  if (!assignment) throw ApiError.notFound('Assignment not found.');
  if (assignment.role !== ROLES.JUDGE) throw ApiError.badRequest('Only judges can be given a judge sign-in here.');
  const { event } = await requireEventAccess(req.user, assignment.event, 'manage');
  assertNotArchived(event);
  const user = await User.findById(assignment.user).select('+tokenVersion');
  if (!user || user.role !== ROLES.JUDGE) throw ApiError.notFound('Judge account not found.');

  const before = { loginEnabled: user.loginEnabled !== false, email: user.email };
  if (req.body?.enabled === false) {
    user.loginEnabled = false;
  } else {
    const login = await parseJudgeLogin(req.body);
    if (!login) throw ApiError.badRequest('Enter the email and password the judge will sign in with.');
    if (login.email !== user.email && (await User.exists({ email: login.email, _id: { $ne: user._id } }))) {
      throw ApiError.conflict('An account with this email already exists.', 'DUPLICATE');
    }
    user.email = login.email;
    await user.setPassword(login.password);
    user.loginEnabled = true;
    user.status = 'active';
    user.mustChangePassword = false;
  }
  // Ends any session the judge already has open
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await audit(req, {
    action: user.loginEnabled ? 'judge.login_set' : 'judge.login_disabled',
    entityType: 'User',
    entityId: user._id,
    entityLabel: user.name,
    event: event._id,
    before,
    after: { loginEnabled: user.loginEnabled, email: user.loginEnabled ? user.email : undefined },
  });
  if (user.loginEnabled && !before.loginEnabled) {
    await notify(user._id, { title: 'Judge sign-in ready', message: `You can now score your assigned categories in "${event.name}".`, link: '/app/judging', event: event._id });
  }
  emitToEvent(event._id, 'assignments:updated');
  res.json({ success: true, user: user.toSafeObject() });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await EventAssignment.findById(req.params.id).populate('user', 'name');
  if (!assignment) throw ApiError.notFound('Assignment not found.');
  const { event } = await requireEventAccess(req.user, assignment.event, 'manage');
  assertNotArchived(event);
  const data = parse(z.object({ categories: z.array(objectId).optional(), order: z.number().int().min(0).optional() }), req.body);

  const before = { categories: assignment.categories.map(String), order: assignment.order };
  if (data.categories && assignment.role === ROLES.JUDGE) {
    const valid = await Category.find({ _id: { $in: data.categories }, event: event._id });
    if (valid.length !== data.categories.length) throw ApiError.badRequest('One or more categories do not belong to this event.');
    const current = new Set(before.categories);
    const next = new Set(data.categories.map(String));
    const changed = [...current].filter((c) => !next.has(c)).concat([...next].filter((c) => !current.has(c)));
    await assertCategoriesEditable(event._id, changed, 'change');
    assignment.categories = data.categories;
  }
  if (data.order !== undefined) assignment.order = data.order;
  await assignment.save();
  await audit(req, {
    action: 'assignment.updated',
    entityType: 'EventAssignment',
    entityId: assignment._id,
    entityLabel: `${assignment.user?.name} as ${assignment.role}`,
    event: event._id,
    before,
    after: { categories: assignment.categories.map(String), order: assignment.order },
  });
  emitToEvent(event._id, 'assignments:updated');
  await assignment.populate([{ path: 'user', select: 'name email role status title' }, { path: 'categories', select: 'name' }]);
  res.json({ success: true, assignment });
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await EventAssignment.findById(req.params.id).populate('user', 'name');
  if (!assignment) throw ApiError.notFound('Assignment not found.');
  const { event } = await requireEventAccess(req.user, assignment.event, 'manage');
  assertNotArchived(event);
  if (assignment.role === ROLES.EVENT_ADMIN && req.user.role !== ROLES.SUPER_ADMIN) throw ApiError.forbidden('Only a Super Admin can remove Event Admins.');
  if (assignment.role === ROLES.JUDGE) {
    await assertCategoriesEditable(event._id, assignment.categories, 'remove');
    if (await ScoreSheet.exists({ event: event._id, judge: assignment.user._id, submissionCount: { $gt: 0 } })) {
      throw ApiError.conflict('This judge already submitted score sheets for this event and cannot be removed.', 'HAS_RECORDS');
    }
    await ScoreSheet.deleteMany({ event: event._id, judge: assignment.user._id, submissionCount: 0 });
  }
  await assignment.deleteOne();
  await audit(req, {
    action: 'assignment.removed',
    entityType: 'EventAssignment',
    entityId: assignment._id,
    entityLabel: `${assignment.user?.name} as ${assignment.role}`,
    event: event._id,
    before: { user: assignment.user?.name, role: assignment.role },
  });
  emitToEvent(event._id, 'assignments:updated');
  res.json({ success: true });
});
