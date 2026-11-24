import { z } from 'zod';
import Setting from '../models/Setting.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parse } from '../utils/validation.js';
import { audit, diff } from '../services/auditService.js';

const FIELDS = ['systemName', 'organizationName', 'reportSubheading', 'publicResultsEnabled', 'defaultDecimalPlaces', 'passwordMinLength', 'reportFooter'];

export const getSettings = asyncHandler(async (_req, res) => {
  res.json({ success: true, settings: await Setting.getGlobal() });
});

export const getPublicSettings = asyncHandler(async (_req, res) => {
  const s = await Setting.getGlobal();
  res.json({ success: true, settings: { systemName: s.systemName, organizationName: s.organizationName, publicResultsEnabled: s.publicResultsEnabled } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const data = parse(
    z.object({
      systemName: z.string().trim().min(2).max(80).optional(),
      organizationName: z.string().trim().max(160).optional(),
      reportSubheading: z.string().trim().max(160).optional(),
      publicResultsEnabled: z.boolean().optional(),
      defaultDecimalPlaces: z.number().int().min(0).max(4).optional(),
      passwordMinLength: z.number().int().min(8).max(64).optional(),
      reportFooter: z.string().trim().max(300).optional(),
    }),
    req.body
  );
  const s = await Setting.getGlobal();
  const before = s.toObject();
  Object.assign(s, data, { updatedBy: req.user._id });
  await s.save();
  const d = diff(before, s.toObject(), FIELDS);
  if (d.changed) await audit(req, { action: 'settings.updated', entityType: 'Setting', entityId: s._id, entityLabel: 'Global settings', before: d.before, after: d.after });
  res.json({ success: true, settings: s });
});
