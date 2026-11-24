import mongoose from 'mongoose';
import Event from '../models/Event.js';
import EventAssignment from '../models/EventAssignment.js';
import ApiError from '../utils/ApiError.js';
import { ROLES } from '../constants/index.js';

/**
 * Event-level access control. Every event-scoped request goes through here so that an
 * Event Admin, Tabulator or Judge can only reach events they are explicitly assigned to.
 *
 * Capabilities:
 *  - manage   : configure the event (super admin, assigned/creating event admin)
 *  - tabulate : view all score sheets, generate results, submit for approval (super admin, assigned tabulator, event admin)
 *  - review   : view tally/score sheets for monitoring & approval (manage OR tabulate)
 *  - approve  : approve / return / publish results (manage)
 *  - judge    : score assigned categories (assigned judge)
 */
export async function resolveEventAccess(user, eventOrId) {
  const event =
    eventOrId instanceof mongoose.Model
      ? eventOrId
      : mongoose.isValidObjectId(eventOrId)
        ? await Event.findById(eventOrId)
        : null;
  if (!event) throw ApiError.notFound('Event not found.');

  if (user.role === ROLES.SUPER_ADMIN) {
    return { event, assignments: [], judgeAssignment: null, can: { manage: true, tabulate: true, review: true, approve: true, judge: false } };
  }

  const assignments = await EventAssignment.find({ event: event._id, user: user._id });
  const has = (role) => assignments.some((a) => a.role === role) && user.role === role;
  const isCreator = user.role === ROLES.EVENT_ADMIN && event.createdBy && event.createdBy.equals(user._id);

  const manage = has(ROLES.EVENT_ADMIN) || isCreator;
  // The event owner/admin may also run the tally (single-operator events).
  const tabulate = has(ROLES.TABULATOR) || manage;
  const judge = has(ROLES.JUDGE);
  return {
    event,
    assignments,
    judgeAssignment: judge ? assignments.find((a) => a.role === ROLES.JUDGE) : null,
    can: { manage, tabulate, review: manage || tabulate, approve: manage, judge },
  };
}

/** Resolves access and throws 403 unless the user has the given capability. */
export async function requireEventAccess(user, eventOrId, capability = 'review') {
  const access = await resolveEventAccess(user, eventOrId);
  const caps = Array.isArray(capability) ? capability : [capability];
  if (!caps.some((c) => access.can[c])) throw ApiError.forbidden('You are not authorized for this event.');
  return access;
}

/** Throws if the event is archived and the operation would modify it. */
export function assertNotArchived(event) {
  if (event.status === 'archived') throw ApiError.conflict('This event is archived and read-only. Restore it first.', 'EVENT_ARCHIVED');
}

/** IDs of events the user may see in listings. */
export async function accessibleEventIds(user) {
  if (user.role === ROLES.SUPER_ADMIN) return null; // null = all
  const assigned = await EventAssignment.find({ user: user._id, role: user.role }).distinct('event');
  if (user.role === ROLES.EVENT_ADMIN) {
    const created = await Event.find({ createdBy: user._id }).distinct('_id');
    return [...new Set([...assigned, ...created].map(String))].map((id) => new mongoose.Types.ObjectId(id));
  }
  return assigned;
}

/** Used by Socket.IO room joins. */
export async function canAccessEvent(user, eventId) {
  try {
    const access = await resolveEventAccess(user, eventId);
    return access.can.review || access.can.judge;
  } catch {
    return false;
  }
}
