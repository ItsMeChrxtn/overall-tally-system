import AuditLog from '../models/AuditLog.js';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Event from '../models/Event.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import TabulationResult from '../models/TabulationResult.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { accessibleEventIds } from '../services/accessService.js';
import { ROLES } from '../constants/index.js';

const ACTIVE_STATUSES = ['upcoming', 'active', 'scoring', 'for_verification', 'for_approval', 'published'];

/** Expected vs submitted sheets per category, considering assigned judges × assigned contestants. */
async function categoryProgress(eventIds) {
  const [categories, assignments, sheets, results] = await Promise.all([
    Category.find({ event: { $in: eventIds } }, 'event name contestants status configLocked order').populate('event', 'name status').lean(),
    EventAssignment.find({ event: { $in: eventIds }, role: ROLES.JUDGE }, 'categories').lean(),
    ScoreSheet.aggregate([{ $match: { event: { $in: eventIds }, status: 'submitted' } }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
    TabulationResult.find({ event: { $in: eventIds }, scope: 'category', status: { $ne: 'superseded' } }, 'category status version').sort({ version: -1 }).lean(),
  ]);
  return categories.map((c) => {
    const judges = assignments.filter((a) => a.categories.some((x) => String(x) === String(c._id))).length;
    const expected = judges * c.contestants.length;
    const submitted = sheets.find((s) => String(s._id) === String(c._id))?.n || 0;
    const latest = results.find((r) => String(r.category) === String(c._id));
    return {
      _id: c._id,
      name: c.name,
      event: c.event,
      status: c.status,
      configLocked: c.configLocked,
      judges,
      contestants: c.contestants.length,
      expected,
      submitted: Math.min(submitted, expected),
      resultStatus: latest?.status || null,
    };
  });
}

async function submissionsByDay(eventFilter, days = 14) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await ScoreSheet.aggregate([
    { $match: { ...eventFilter, submittedAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt', timezone: 'Asia/Manila' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    out.push({ date: d, submissions: rows.find((r) => r._id === d)?.n || 0 });
  }
  return out;
}

export const getDashboard = asyncHandler(async (req, res) => {
  const { role } = req.user;

  if (role === ROLES.SUPER_ADMIN) {
    const [totalEvents, activeEvents, completedEvents, users, judges, contestants, byStatus, byType, recent, pendingApprovals] = await Promise.all([
      Event.countDocuments({ status: { $ne: 'archived' } }),
      Event.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
      Event.countDocuments({ status: 'completed' }),
      User.countDocuments(),
      User.countDocuments({ role: ROLES.JUDGE }),
      Contestant.countDocuments(),
      Event.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Event.aggregate([{ $match: { status: { $ne: 'archived' } } }, { $group: { _id: '$eventType', n: { $sum: 1 } } }]),
      AuditLog.find().sort({ createdAt: -1 }).limit(12).populate('event', 'name').lean(),
      TabulationResult.countDocuments({ status: 'for_approval' }),
    ]);
    const upcoming = await Event.find({ status: { $in: ACTIVE_STATUSES } }, 'name status eventDate venue eventType').sort({ eventDate: 1 }).limit(6).lean();
    return res.json({
      success: true,
      role,
      stats: { totalEvents, activeEvents, completedEvents, users, judges, contestants, pendingApprovals },
      eventsByStatus: byStatus.map((s) => ({ status: s._id, count: s.n })),
      eventsByType: byType.map((s) => ({ type: s._id, count: s.n })),
      submissions: await submissionsByDay({}),
      recentActivity: recent,
      activeEvents: upcoming,
    });
  }

  const ids = await accessibleEventIds(req.user);
  const events = await Event.find({ _id: { $in: ids }, status: { $ne: 'archived' } }, 'name status eventDate venue eventType coverImage').sort({ eventDate: -1 }).lean();
  const eventIds = events.map((e) => e._id);

  if (role === ROLES.JUDGE) {
    const assignments = await EventAssignment.find({ user: req.user._id, role: ROLES.JUDGE, event: { $in: eventIds } }).populate('categories', 'name status configLocked contestants event').lean();
    const sheets = await ScoreSheet.aggregate([{ $match: { judge: req.user._id } }, { $group: { _id: { c: '$category', s: '$status' }, n: { $sum: 1 } } }]);
    const categories = assignments.flatMap((a) =>
      a.categories.map((c) => {
        const submitted = sheets.find((s) => String(s._id.c) === String(c._id) && s._id.s === 'submitted')?.n || 0;
        const event = events.find((e) => String(e._id) === String(a.event));
        return { _id: c._id, name: c.name, status: c.status, scoringOpen: c.configLocked && c.status === 'scoring', event: { _id: event?._id, name: event?.name }, total: c.contestants.length, submitted };
      })
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return res.json({
      success: true,
      role,
      stats: {
        assignedEvents: events.length,
        pendingSheets: categories.filter((c) => c.scoringOpen).reduce((a, c) => a + Math.max(0, c.total - c.submitted), 0),
        completedEvaluations: categories.reduce((a, c) => a + c.submitted, 0),
        openCategories: categories.filter((c) => c.scoringOpen).length,
      },
      categories,
      upcoming: events.filter((e) => e.eventDate && new Date(e.eventDate) >= today).slice(0, 5),
      events,
    });
  }

  const progress = await categoryProgress(eventIds);
  const expected = progress.filter((p) => p.configLocked).reduce((a, p) => a + p.expected, 0);
  const submitted = progress.filter((p) => p.configLocked).reduce((a, p) => a + p.submitted, 0);
  const [contestants, judges, recent, forApproval] = await Promise.all([
    Contestant.countDocuments({ event: { $in: eventIds }, status: 'active' }),
    EventAssignment.countDocuments({ event: { $in: eventIds }, role: ROLES.JUDGE }),
    AuditLog.find({ event: { $in: eventIds } }).sort({ createdAt: -1 }).limit(10).populate('event', 'name').lean(),
    TabulationResult.find({ event: { $in: eventIds }, status: 'for_approval' }, 'title version event category submittedAt').populate('event', 'name').lean(),
  ]);

  const base = {
    success: true,
    role,
    events,
    progress,
    recentActivity: recent,
    forApproval,
  };

  if (role === ROLES.EVENT_ADMIN) {
    return res.json({
      ...base,
      stats: { assignedEvents: events.length, contestants, judges, pendingSubmissions: expected - submitted, completedSubmissions: submitted, awaitingApproval: forApproval.length },
      submissions: await submissionsByDay({ event: { $in: eventIds } }),
    });
  }

  // Tabulator
  const awaitingVerification = progress.filter((p) => p.configLocked && (!p.resultStatus || ['preliminary', 'returned', 'superseded'].includes(p.resultStatus)));
  return res.json({
    ...base,
    stats: {
      assignedEvents: events.length,
      pendingSubmissions: expected - submitted,
      completedSheets: submitted,
      awaitingVerification: awaitingVerification.length,
      awaitingApproval: forApproval.length,
      tabulationProgress: expected ? Math.round((submitted / expected) * 100) : 0,
    },
    awaitingVerification,
  });
});
