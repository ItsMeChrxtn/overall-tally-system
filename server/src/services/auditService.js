import AuditLog from '../models/AuditLog.js';

/**
 * Records an audit entry. Failures are logged but never break the main request.
 * @param {import('express').Request|null} req
 */
export async function audit(req, { action, entityType, entityId, entityLabel, event, before, after, meta, user }) {
  try {
    const actor = user || req?.user;
    await AuditLog.create({
      user: actor?._id,
      userName: actor?.name,
      userRole: actor?.role,
      action,
      entityType,
      entityId,
      entityLabel,
      event,
      before: sanitize(before),
      after: sanitize(after),
      meta,
      ip: req ? req.ip : undefined,
    });
  } catch (err) {
    console.error('[audit] failed to write log:', err.message);
  }
}

/** Strips internal/sensitive fields before storing a snapshot. */
function sanitize(value) {
  if (value === undefined || value === null) return value;
  const plain = typeof value.toObject === 'function' ? value.toObject() : value;
  if (typeof plain !== 'object') return plain;
  const clone = JSON.parse(JSON.stringify(plain));
  for (const key of ['passwordHash', 'resetPasswordTokenHash', 'resetPasswordExpires', 'tokenVersion', '__v']) delete clone[key];
  return clone;
}

/** Returns only the keys whose values changed, for compact before/after logs. */
export function diff(before, after, keys) {
  const b = {};
  const a = {};
  for (const k of keys) {
    const bv = JSON.stringify(before?.[k] ?? null);
    const av = JSON.stringify(after?.[k] ?? null);
    if (bv !== av) {
      b[k] = before?.[k] ?? null;
      a[k] = after?.[k] ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
