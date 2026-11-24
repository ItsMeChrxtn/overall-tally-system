import { asyncHandler } from '../utils/asyncHandler.js';
import ApiError from '../utils/ApiError.js';
import { requireEventAccess } from '../services/accessService.js';
import { audit } from '../services/auditService.js';
import { buildReport, REPORT_TYPES, reportToExcel } from '../services/reportService.js';

export const reportTypes = asyncHandler(async (_req, res) => {
  res.json({ success: true, types: Object.entries(REPORT_TYPES).map(([key, v]) => ({ key, ...v })) });
});

export const getReport = asyncHandler(async (req, res) => {
  const { type, eventId } = req.params;
  const def = REPORT_TYPES[type];
  if (!def) throw ApiError.badRequest('Unknown report type.');
  const { event } = await requireEventAccess(req.user, eventId, def.needsManage ? 'manage' : 'review');
  const params = {
    category: req.query.category,
    judge: req.query.judge,
    contestant: req.query.contestant,
    result: req.query.result,
    from: req.query.from,
    to: req.query.to,
  };
  const report = await buildReport({ event, type, params, user: req.user });
  const format = req.query.format || 'json';

  if (format === 'xlsx') {
    const buffer = await reportToExcel(report);
    await audit(req, { action: 'report.exported', entityType: 'Event', entityId: event._id, entityLabel: `${report.title} (Excel)`, event: event._id, meta: params });
    const safe = `${event.name}-${report.title}${report.subtitle ? `-${report.subtitle}` : ''}`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 120);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.xlsx"`);
    return res.send(Buffer.from(buffer));
  }
  if (req.query.log === '1') {
    await audit(req, { action: 'report.exported', entityType: 'Event', entityId: event._id, entityLabel: `${report.title} (${req.query.as || 'PDF/Print'})`, event: event._id, meta: params });
  }
  res.json({ success: true, report });
});
