import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Criterion from '../models/Criterion.js';
import Event from '../models/Event.js';
import EventAssignment from '../models/EventAssignment.js';
import ResultApproval from '../models/ResultApproval.js';
import ScoreSheet from '../models/ScoreSheet.js';
import ScoringConfiguration from '../models/ScoringConfiguration.js';
import TabulationResult from '../models/TabulationResult.js';
import ApiError from '../utils/ApiError.js';
import { sha256 } from '../utils/token.js';
import { RESULT_LOCKING_STATUSES, ROLES } from '../constants/index.js';
import { computeCategoryTally, computeOverallTally, computeSpecialAwards, maxPossibleScore, methodUsesCriteria, CUSTOM_STRATEGY_REGISTRY } from './scoringEngine.js';
import { audit } from './auditService.js';
import { notify } from './notificationService.js';
import { emitToEvent } from './realtime.js';

const PRE_SCORING_EVENT_STATUSES = ['draft', 'upcoming', 'active'];

// ------------------------------------------------------------------ configuration
export async function judgesForCategory(category) {
  const assignments = await EventAssignment.find({ event: category.event, role: ROLES.JUDGE, categories: category._id })
    .populate('user', 'name status title')
    .sort({ order: 1, createdAt: 1 });
  return assignments
    .filter((a) => a.user)
    .map((a, i) => ({ userId: a.user._id, name: a.user.name, title: a.user.title, status: a.user.status, order: a.order || i + 1 }));
}

/** Current (editable) configuration built from live records. */
export async function buildLiveConfig(category) {
  const [criteria, judges, contestants] = await Promise.all([
    Criterion.find({ category: category._id, isActive: true }).sort({ order: 1, createdAt: 1 }),
    judgesForCategory(category),
    Contestant.find({ _id: { $in: category.contestants }, status: 'active' }).sort({ number: 1 }),
  ]);
  return {
    version: category.configVersion,
    categoryName: category.name,
    scoringMethod: category.scoringMethod,
    customStrategy: category.customStrategy,
    decimalPlaces: category.decimalPlaces,
    criteria: criteria.map((c) => ({
      criterionId: c._id,
      name: c.name,
      description: c.description,
      weight: c.weight,
      minScore: c.minScore,
      maxScore: c.maxScore,
      decimalPlaces: c.decimalPlaces,
      order: c.order,
    })),
    tieBreakRules: (category.tieBreakRules || []).map((r) => ({ type: r.type, criterionId: r.criterion, judgeId: r.judge })),
    judges: judges.map((j) => ({ userId: j.userId, name: j.name, order: j.order })),
    contestants: contestants.map((c) => ({ contestantId: c._id, number: c.number, name: c.name })),
  };
}

/** The configuration scoring actually runs under: the locked snapshot once scoring has opened, otherwise the live setup. */
export async function getEffectiveConfig(category) {
  if (category.configLocked && category.configVersion > 0) {
    const snap = await ScoringConfiguration.findOne({ category: category._id, version: category.configVersion }).lean();
    if (snap) return { ...snap, locked: true };
  }
  return { ...(await buildLiveConfig(category)), locked: false };
}

/** Validates a category's setup. Used by the admin "configuration check" and before locking. */
export async function checkConfiguration(category) {
  const errors = [];
  const warnings = [];
  const config = await buildLiveConfig(category);
  const usesCriteria = methodUsesCriteria(category.scoringMethod);

  if (category.scoringMethod === 'custom' && !CUSTOM_STRATEGY_REGISTRY[category.customStrategy]) {
    errors.push('Select a custom scoring strategy.');
  }
  if (usesCriteria) {
    if (!config.criteria.length) errors.push('Add at least one active judging criterion.');
    for (const c of config.criteria) {
      if (c.weight < 0) errors.push(`"${c.name}" has a negative weight.`);
      if (c.minScore < 0) errors.push(`"${c.name}" has a negative minimum score.`);
      if (!(c.maxScore > c.minScore)) errors.push(`"${c.name}" must have a maximum score greater than its minimum.`);
    }
    const needsWeights = category.scoringMethod === 'weighted' || category.scoringMethod === 'custom';
    const totalWeight = config.criteria.reduce((a, c) => a + (c.weight || 0), 0);
    if (needsWeights && Math.abs(totalWeight - 100) > 1e-6) errors.push(`Criteria weights must total exactly 100% (currently ${+totalWeight.toFixed(4)}%).`);
    if (!needsWeights && totalWeight > 0 && Math.abs(totalWeight - 100) > 1e-6) {
      warnings.push(`Weights are not used by the ${category.scoringMethod} method (currently ${+totalWeight.toFixed(4)}%).`);
    }
  } else if (config.criteria.length) {
    warnings.push('Rank-based scoring ignores criteria scores; criteria are shown to judges as guidance only.');
  }

  if (!config.judges.length) errors.push('Assign at least one judge to this category.');
  const inactiveJudges = (await judgesForCategory(category)).filter((j) => j.status !== 'active');
  if (inactiveJudges.length) errors.push(`Inactive judge account(s) assigned: ${inactiveJudges.map((j) => j.name).join(', ')}.`);
  const minContestants = category.scoringMethod === 'rank' ? 2 : 1;
  if (config.contestants.length < minContestants) errors.push(`Assign at least ${minContestants} active contestant(s).`);

  const rules = category.tieBreakRules || [];
  for (const r of rules) {
    if (r.type === 'criterion' && !config.criteria.some((c) => String(c.criterionId) === String(r.criterion))) {
      errors.push('A tie-break rule references a criterion that is missing or disabled.');
    }
    if (r.type === 'judge' && !config.judges.some((j) => String(j.userId) === String(r.judge))) {
      errors.push('A tie-break rule references a judge who is not assigned to this category.');
    }
    if ((r.type === 'criterion' || r.type === 'highest_weight_criterion') && !usesCriteria) {
      warnings.push('Criterion-based tie-break rules are skipped for rank-based scoring.');
    }
  }
  if (!rules.length) warnings.push('No tie-break rules configured: tied contestants will share the rank.');

  const event = await Event.findById(category.event);
  if (event?.status === 'archived') errors.push('The event is archived.');

  return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], config };
}

async function activeLockingResult(filter) {
  return TabulationResult.findOne({ ...filter, status: { $in: RESULT_LOCKING_STATUSES } });
}

export async function assertNoLockingResult(category) {
  const r = await activeLockingResult({ category: category._id, scope: 'category' });
  if (r) {
    throw ApiError.conflict(
      `Result version ${r.version} is ${r.status.replace('_', ' ')}. It must be returned or unpublished before scores can change.`,
      'RESULT_LOCKED'
    );
  }
}

/** Opens scoring: validates, snapshots the configuration and locks it. */
export async function lockConfiguration(req, category) {
  if (category.configLocked) throw ApiError.conflict('Scoring configuration is already locked.');
  const check = await checkConfiguration(category);
  if (!check.ok) throw ApiError.badRequest('The configuration has problems that must be fixed first.', 'CONFIG_INVALID', { errors: check.errors });

  const version = category.configVersion + 1;
  const { config } = check;
  await ScoringConfiguration.create({
    event: category.event,
    category: category._id,
    version,
    categoryName: category.name,
    scoringMethod: config.scoringMethod,
    customStrategy: config.customStrategy,
    decimalPlaces: config.decimalPlaces,
    criteria: config.criteria,
    tieBreakRules: config.tieBreakRules,
    judges: config.judges,
    contestants: config.contestants,
    lockedBy: req.user._id,
    lockedAt: new Date(),
  });
  category.configLocked = true;
  category.configVersion = version;
  category.status = 'scoring';
  category.lockedAt = new Date();
  category.lockedBy = req.user._id;
  await category.save();

  const event = await Event.findById(category.event);
  if (event && PRE_SCORING_EVENT_STATUSES.includes(event.status)) {
    const before = event.status;
    event.status = 'scoring';
    await event.save();
    await audit(req, { action: 'event.status_changed', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, before: { status: before }, after: { status: 'scoring' }, meta: { automatic: true } });
  }

  await audit(req, {
    action: 'category.config_locked',
    entityType: 'Category',
    entityId: category._id,
    entityLabel: category.name,
    event: category.event,
    after: { version, scoringMethod: config.scoringMethod, criteria: config.criteria.map((c) => `${c.name} (${c.weight}%)`), judges: config.judges.map((j) => j.name) },
  });
  await notify(
    config.judges.map((j) => j.userId),
    { title: 'Scoring is open', message: `You can now score "${category.name}".`, link: `/app/judging/${category._id}`, type: 'scoring', event: category.event }
  );
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id), status: category.status });
  return { category, version, warnings: check.warnings };
}

/** Formally reopens a locked configuration. All submitted sheets are reopened so judges re-confirm under the new version. */
export async function reopenConfiguration(req, category, reason) {
  if (!category.configLocked) throw ApiError.conflict('The configuration is not locked.');
  await assertNoLockingResult(category);

  await ScoringConfiguration.updateOne(
    { category: category._id, version: category.configVersion },
    { reopenedBy: req.user._id, reopenedAt: new Date(), reopenReason: reason }
  );
  const sheets = await ScoreSheet.find({ category: category._id, status: 'submitted' });
  for (const s of sheets) {
    s.status = 'reopened';
    s.reopenedAt = new Date();
    s.reopenedBy = req.user._id;
    s.reopenReason = `Configuration reopened: ${reason}`;
    s.history.push({ action: 'reopened', by: req.user._id, note: s.reopenReason, scores: s.scores, rank: s.rank });
    await s.save();
  }
  category.configLocked = false;
  category.status = 'setup';
  await category.save();
  await supersedeOpenVersions({ category: category._id, scope: 'category' });

  await audit(req, {
    action: 'category.config_reopened',
    entityType: 'Category',
    entityId: category._id,
    entityLabel: category.name,
    event: category.event,
    before: { configLocked: true, version: category.configVersion },
    after: { configLocked: false },
    meta: { reason, reopenedSheets: sheets.length },
  });
  const judges = await judgesForCategory(category);
  await notify(
    judges.map((j) => j.userId),
    { title: 'Scoring configuration reopened', message: `"${category.name}" was reopened by the organizers. Please wait for scoring to reopen and re-submit your sheets.`, type: 'warning', event: category.event }
  );
  emitToEvent(category.event, 'category:updated', { categoryId: String(category._id), status: category.status });
  return { category, reopenedSheets: sheets.length };
}

// ------------------------------------------------------------------ tally
function hashSheets(configVersion, sheets) {
  const parts = sheets
    .map((s) => `${s._id}:${s.status}:${s.configVersion}:${s.rank ?? ''}:${(s.scores || []).map((x) => `${x.criterion}=${x.value}`).sort().join(',')}`)
    .sort();
  return sha256(`${configVersion}|${parts.join('|')}`);
}

/**
 * Awards configured on the category; a Multimedia Film category with none configured gets its
 * standard awards automatically (no setup step needed):
 *   Best Story / Screenplay – highest average in the "Script / Storyboard" criterion
 *   Best Multimedia Film    – 1st place
 */
function effectiveAwards(category, config) {
  if (category.specialAwards?.length) {
    return category.specialAwards.map((a) => ({ name: a.name, basis: a.basis, criterionId: a.criterion }));
  }
  if (!/multimedia\s*film/i.test(category.name || '')) return [];
  const script = (config.criteria || []).find((c) => /script|storyboard|screenplay/i.test(c.name || ''));
  return [
    ...(script ? [{ name: 'Best Story / Screenplay', basis: 'criterion', criterionId: script.criterionId }] : []),
    { name: 'Best Multimedia Film', basis: 'final' },
  ];
}

/** Computes the current tally for a category (not saved). */
export async function computeLiveCategoryTally(category) {
  const config = await getEffectiveConfig(category);
  const sheets = await ScoreSheet.find({ category: category._id }).lean();
  // Only sheets produced under the effective configuration count
  const relevant = sheets.filter((s) => !config.locked || s.configVersion === config.version || s.status !== 'submitted');
  const tally = computeCategoryTally(config, relevant);
  // Special awards are presentation titles (not part of the locked snapshot), derived from the tally.
  const awards = effectiveAwards(category, config);
  tally.awards = computeSpecialAwards(tally, awards);
  tally.awardees = category.awardees ?? 3;
  let dataHash = hashSheets(config.version, sheets.filter((s) => s.status === 'submitted'));
  // Changing the awards after a result is generated makes that result stale (only when awards exist, so older hashes stay valid)
  if (awards.length) dataHash = sha256(`${dataHash}|awards:${awards.map((a) => `${a.name}/${a.basis}/${a.criterionId ?? ''}`).join(';')}`);
  return { config, tally, dataHash };
}

/** Computes the event-wide overall tally (not saved). */
export async function computeLiveOverallTally(event) {
  if (!event.overall?.enabled) throw ApiError.badRequest('The overall tally is not enabled for this event.');
  const categories = await Category.find({ event: event._id, includeInOverall: true }).sort({ order: 1, createdAt: 1 });
  if (!categories.length) throw ApiError.badRequest('No categories are included in the overall tally.');
  const parts = [];
  const hashes = [];
  const contestantMap = new Map();
  for (const category of categories) {
    const { config, tally, dataHash } = await computeLiveCategoryTally(category);
    parts.push({ categoryId: category._id, name: category.name, weight: category.overallWeight, order: category.order, tally, maxPossible: maxPossibleScore(config), locked: config.locked });
    hashes.push(dataHash);
    for (const c of config.contestants) contestantMap.set(String(c.contestantId), c);
  }
  const overall = computeOverallTally({
    parts,
    method: event.overall.method,
    decimalPlaces: event.overall.decimalPlaces ?? 2,
    contestants: [...contestantMap.values()].sort((a, b) => a.number - b.number),
  });
  const notLocked = parts.filter((p) => !p.locked).map((p) => p.name);
  if (notLocked.length) overall.warnings.push(`Scoring has not opened for: ${notLocked.join(', ')}.`);
  overall.complete = overall.complete && notLocked.length === 0;
  return { tally: overall, dataHash: sha256(hashes.join('|')), categories };
}

async function supersedeOpenVersions(filter) {
  await TabulationResult.updateMany({ ...filter, status: { $in: ['preliminary', 'returned'] } }, { status: 'superseded' });
}

async function logApproval(req, result, action, fromStatus, note) {
  await ResultApproval.create({
    result: result._id,
    event: result.event,
    category: result.category,
    action,
    fromStatus,
    toStatus: result.status,
    by: req.user._id,
    byName: req.user.name,
    byRole: req.user.role,
    note,
  });
}

/** Saves a new preliminary result version from the live tally. */
export async function generateResult(req, { event, category }) {
  const scope = category ? 'category' : 'overall';
  const filter = scope === 'category' ? { category: category._id, scope } : { event: event._id, scope, category: null };
  const locking = await activeLockingResult(filter);
  if (locking) throw ApiError.conflict(`Version ${locking.version} is already ${locking.status.replace('_', ' ')}. Return or unpublish it before generating a new version.`, 'RESULT_LOCKED');

  let payload;
  if (scope === 'category') {
    if (!category.configVersion || !category.configLocked) throw ApiError.badRequest('Scoring has not been opened for this category yet.', 'NOT_LOCKED');
    const { config, tally, dataHash } = await computeLiveCategoryTally(category);
    payload = {
      title: category.name,
      configVersion: config.version,
      scoringMethod: tally.scoringMethod,
      customStrategy: tally.customStrategy,
      decimalPlaces: tally.decimalPlaces,
      direction: tally.direction,
      complete: tally.complete,
      judges: tally.judges,
      criteria: tally.criteria,
      rows: tally.rows,
      ties: tally.ties,
      awards: tally.awards,
      missing: tally.missing,
      warnings: tally.warnings,
      summary: { ...tally.summary, methodLabel: tally.methodLabel },
      dataHash,
    };
  } else {
    const { tally, dataHash } = await computeLiveOverallTally(event);
    payload = {
      title: event.overall.title || 'Overall Tally',
      scoringMethod: `overall_${tally.method}`,
      decimalPlaces: tally.decimalPlaces,
      direction: tally.direction,
      complete: tally.complete,
      criteria: tally.categories,
      rows: tally.rows,
      ties: tally.ties,
      missing: [],
      warnings: tally.warnings,
      summary: { categories: tally.categories.length, contestants: tally.rows.length, methodLabel: tally.method === 'weighted' ? 'Weighted category scores' : 'Sum of category ranks' },
      dataHash,
    };
  }

  const last = await TabulationResult.findOne(filter).sort({ version: -1 });
  await supersedeOpenVersions(filter);
  const result = await TabulationResult.create({
    ...payload,
    event: event._id,
    category: category ? category._id : null,
    scope,
    version: (last?.version || 0) + 1,
    status: 'preliminary',
    generatedBy: req.user._id,
    generatedAt: new Date(),
  });
  await logApproval(req, result, 'generated', null, payload.complete ? 'Complete score sheets' : 'Incomplete score sheets');
  await audit(req, {
    action: 'result.generated',
    entityType: 'TabulationResult',
    entityId: result._id,
    entityLabel: `${result.title} v${result.version}`,
    event: event._id,
    after: { version: result.version, complete: result.complete, top: result.rows.slice(0, 3).map((r) => `${r.rank ?? '-'}: #${r.number} ${r.name} (${r.finalScore})`) },
  });
  emitToEvent(event._id, 'result:updated', { resultId: String(result._id), categoryId: category ? String(category._id) : null, status: result.status });
  return result;
}

/** Re-runs the computation and confirms the stored result still matches the data (integrity check). */
export async function verifyResultIntegrity(result) {
  if (result.scope === 'category') {
    const category = await Category.findById(result.category);
    if (!category) throw ApiError.notFound('Category not found.');
    if (category.configVersion !== result.configVersion) {
      throw ApiError.conflict('The scoring configuration changed after this result was generated. Generate a new version.', 'RESULT_STALE');
    }
    const { dataHash } = await computeLiveCategoryTally(category);
    if (dataHash !== result.dataHash) throw ApiError.conflict('Score sheets or special awards changed after this result was generated. Generate a new version.', 'RESULT_STALE');
    return category;
  }
  const event = await Event.findById(result.event);
  const { dataHash } = await computeLiveOverallTally(event);
  if (dataHash !== result.dataHash) throw ApiError.conflict('Category scores changed after this overall result was generated. Generate a new version.', 'RESULT_STALE');
  return null;
}

async function staffIds(eventId, role) {
  return EventAssignment.find({ event: eventId, role }).distinct('user');
}

const TRANSITIONS = {
  // Single-operator flow: the administrator finalizes a preliminary result directly (no "for approval" step).
  finalize: { from: ['preliminary', 'for_approval'], to: 'approved', action: 'approved' },
  submit: { from: ['preliminary'], to: 'for_approval', action: 'submitted' },
  approve: { from: ['for_approval'], to: 'approved', action: 'approved' },
  return: { from: ['for_approval', 'approved'], to: 'returned', action: 'returned' },
  publish: { from: ['approved'], to: 'published', action: 'published' },
  unpublish: { from: ['published'], to: 'approved', action: 'unpublished' },
};

/** Moves a result through the approval workflow. Permission checks happen in the controller. */
export async function transitionResult(req, result, kind, note) {
  const t = TRANSITIONS[kind];
  if (!t.from.includes(result.status)) {
    throw ApiError.conflict(`Cannot ${kind} a result that is ${result.status.replace('_', ' ')}.`, 'INVALID_TRANSITION');
  }
  const event = await Event.findById(result.event);
  if (event.status === 'archived') throw ApiError.conflict('The event is archived.', 'EVENT_ARCHIVED');

  let category = null;
  if (['finalize', 'submit', 'approve', 'publish'].includes(kind)) {
    category = await verifyResultIntegrity(result);
  } else if (result.category) {
    category = await Category.findById(result.category);
  }

  if (kind === 'submit' || kind === 'finalize') {
    const latest = await TabulationResult.findOne({ event: result.event, category: result.category, scope: result.scope }).sort({ version: -1 });
    if (String(latest._id) !== String(result._id)) throw ApiError.conflict('Only the latest result version can be finalized.');
    if (!result.complete && !event.settings?.allowIncompleteRanking) {
      throw ApiError.badRequest('Results cannot be finalized while score sheets are missing.', 'INCOMPLETE');
    }
  }
  if ((kind === 'return' || kind === 'unpublish') && !note) throw ApiError.badRequest('A reason is required.');

  const from = result.status;
  result.status = t.to;
  const now = new Date();
  if (kind === 'submit') Object.assign(result, { submittedBy: req.user._id, submittedAt: now, verificationNote: note });
  if (kind === 'approve') Object.assign(result, { approvedBy: req.user._id, approvedAt: now });
  if (kind === 'finalize') {
    Object.assign(result, { submittedBy: result.submittedBy || req.user._id, submittedAt: result.submittedAt || now, verificationNote: note || result.verificationNote, approvedBy: req.user._id, approvedAt: now });
  }
  if (kind === 'return') Object.assign(result, { returnedBy: req.user._id, returnedAt: now, returnReason: note });
  if (kind === 'publish') Object.assign(result, { publishedBy: req.user._id, publishedAt: now });
  await result.save();
  await logApproval(req, result, t.action, from, note);

  // Side effects on category / event state
  if (category) {
    if ((kind === 'submit' || kind === 'finalize') && category.status === 'scoring') {
      category.status = 'closed';
      await category.save();
    }
    if (kind === 'return' && category.status === 'closed') {
      category.status = 'scoring';
      await category.save();
    }
  }
  const eventBefore = event.status;
  if (kind === 'submit' && ['scoring', 'for_verification', ...PRE_SCORING_EVENT_STATUSES].includes(event.status)) event.status = 'for_approval';
  if (kind === 'publish') {
    event.publishedAt = now;
    if (!['completed', 'archived'].includes(event.status)) event.status = 'published';
  }
  if (event.isModified()) {
    await event.save();
    if (eventBefore !== event.status) {
      await audit(req, { action: 'event.status_changed', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, before: { status: eventBefore }, after: { status: event.status }, meta: { automatic: true } });
    }
  }

  await audit(req, {
    action: `result.${t.action}`,
    entityType: 'TabulationResult',
    entityId: result._id,
    entityLabel: `${result.title} v${result.version}`,
    event: result.event,
    before: { status: from },
    after: { status: result.status },
    meta: note ? { note } : undefined,
  });

  const label = `${result.title} (v${result.version})`;
  const link = `/app/events/${result.event}/tally`;
  if (kind === 'submit') await notify(await staffIds(result.event, ROLES.EVENT_ADMIN), { title: 'Results awaiting approval', message: `${label} was submitted for approval.`, link, type: 'approval', event: result.event });
  if (kind === 'approve') await notify(await staffIds(result.event, ROLES.TABULATOR), { title: 'Results approved', message: `${label} was approved.`, link, type: 'success', event: result.event });
  if (kind === 'return') await notify(await staffIds(result.event, ROLES.TABULATOR), { title: 'Results returned for correction', message: `${label}: ${note}`, link, type: 'warning', event: result.event });
  if (kind === 'publish') await notify([...(await staffIds(result.event, ROLES.TABULATOR)), ...(await staffIds(result.event, ROLES.EVENT_ADMIN))], { title: 'Results published', message: `${label} is now public.`, link, type: 'success', event: result.event });

  emitToEvent(result.event, 'result:updated', { resultId: String(result._id), categoryId: result.category ? String(result.category) : null, status: result.status });
  return result;
}
