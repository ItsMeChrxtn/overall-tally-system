import mongoose from 'mongoose';
import { z } from 'zod';
import ApiError from './ApiError.js';

/** Parses `data` with a zod schema; throws a 400 ApiError with field messages on failure. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.entries(fields)[0];
    throw ApiError.badRequest(first ? `${first[0] === '_' ? '' : `${first[0]}: `}${first[1]}` : 'Invalid input.', 'VALIDATION_ERROR', {
      fields,
    });
  }
  return result.data;
}

export const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v), { message: 'Invalid id' });

export const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v) : v === null ? null : undefined))
  .refine((v) => v === undefined || v === null || !Number.isNaN(v.getTime()), { message: 'Invalid date' });

export const passwordSchema = (min = 8) =>
  z
    .string()
    .min(min, `Password must be at least ${min} characters`)
    .max(128)
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Password must contain letters and numbers' });

export function assertObjectId(id, label = 'id') {
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest(`Invalid ${label}.`, 'INVALID_ID');
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Counts decimal places of a number as entered (e.g. 9.25 -> 2). */
export function decimalsOf(n) {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}
