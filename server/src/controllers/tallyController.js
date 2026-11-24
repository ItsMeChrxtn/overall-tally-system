import { z } from 'zod';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import ResultApproval from '../models/ResultApproval.js';
import TabulationResult from '../models/TabulationResult.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { parse } from '../utils/validation.js';
import { assertNotArchived, requireEventAccess } from '../services/accessService.js';
import { computeLiveCategoryTally, computeLiveOverallTally, generateResult, transitionResult } from '../services/tabulationService.js';

async function contestantExtras(eventId) {
  const list = await Contestant.find({ event: eventId }, 'number name photo representing teamName isTeam status').lean();
  return Object.fromEntries(list.map((c) => [String(c._id), { photo: c.photo, representing: c.representing, teamName: c.teamName, isTeam: c.isTeam, status: c.status }]));
}

export const liveCategoryTally = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  const { can, event } = await requireEventAccess(req.user, category.event, 'review');
  const { config, tally } = await computeLiveCategoryTally(category);
  const [results, extras] = await Promise.all([
    TabulationResult.find({ category: category._id, scope: 'category' }, 'version status complete generatedAt submittedAt approvedAt publishedAt returnReason').sort({ version: -1 }).limit(20),
    contestantExtras(category.event),
  ]);
  res.json({
    success: true,
    category: { _id: category._id, name: category.name, status: category.status, configLocked: category.configLocked, configVersion: category.configVersion },
    event: { _id: event._id, name: event.name, allowIncompleteRanking: event.settings.allowIncompleteRanking },
    locked: config.locked,
    tally,
    extras,
    results,
    can,
  });
});

export const generateCategoryResult = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  const { event } = await requireEventAccess(req.user, category.event, 'tabulate');
  assertNotArchived(event);
  const result = await generateResult(req, { event, category });
  res.status(201).json({ success: true, result });
});

export const listCategoryResults = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found.');
  await requireEventAccess(req.user, category.event, 'review');
  const items = await TabulationResult.find({ category: category._id, scope: 'category' }, '-rows -missing -ties -judges -criteria').sort({ version: -1 });
  res.json({ success: true, items });
});

export const liveOverallTally = asyncHandler(async (req, res) => {
  const { event, can } = await requireEventAccess(req.user, req.params.eventId, 'review');
  const categories = await Category.find({ event: event._id }, 'name includeInOverall overallWeight scoringMethod customStrategy order').sort({ order: 1 });
  const results = await TabulationResult.find({ event: event._id, scope: 'overall' }, 'version status complete generatedAt submittedAt approvedAt publishedAt returnReason').sort({ version: -1 }).limit(20);
  if (!event.overall?.enabled) return res.json({ success: true, enabled: false, overall: event.overall, categories, results, can });
  let tally = null;
  let error = null;
  try {
    ({ tally } = await computeLiveOverallTally(event));
  } catch (err) {
    error = err.message;
  }
  res.json({ success: true, enabled: true, overall: event.overall, categories, tally, error, results, extras: await contestantExtras(event._id), can });
});

export const generateOverallResult = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'tabulate');
  assertNotArchived(event);
  const result = await generateResult(req, { event, category: null });
  res.status(201).json({ success: true, result });
});

export const listEventResults = asyncHandler(async (req, res) => {
  const { event } = await requireEventAccess(req.user, req.params.eventId, 'review');
  const items = await TabulationResult.find({ event: event._id, status: { $ne: 'superseded' } }, 'title scope category version status complete generatedAt submittedAt approvedAt publishedAt')
    .populate('category', 'name')
    .sort({ scope: 1, createdAt: -1 });
  res.json({ success: true, items });
});

export const getResult = asyncHandler(async (req, res) => {
  const result = await TabulationResult.findById(req.params.id)
    .populate('generatedBy submittedBy approvedBy returnedBy publishedBy', 'name role')
    .populate('event', 'name eventDate venue settings')
    .populate('category', 'name');
  if (!result) throw ApiError.notFound('Result not found.');
  const { can } = await requireEventAccess(req.user, result.event._id, 'review');
  const history = await ResultApproval.find({ result: result._id }).sort({ createdAt: 1 });
  res.json({ success: true, result, history, extras: await contestantExtras(result.event._id), can });
});

const CAPABILITY = { submit: 'tabulate', approve: 'approve', return: 'approve', publish: 'approve', unpublish: 'approve' };

export const transition = (kind) =>
  asyncHandler(async (req, res) => {
    const result = await TabulationResult.findById(req.params.id);
    if (!result) throw ApiError.notFound('Result not found.');
    await requireEventAccess(req.user, result.event, CAPABILITY[kind]);
    const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body);
    const updated = await transitionResult(req, result, kind, note);
    res.json({ success: true, result: updated });
  });
