/**
 * CENTRALIZED SCORING ENGINE
 * ---------------------------------------------------------------------------
 * Pure, deterministic functions (no database access) that turn a locked scoring
 * configuration + submitted score sheets into an official tally.
 *
 * Every official number in the system (tally tables, rankings, reports, public
 * results) is produced here on the server. The frontend only shows previews.
 *
 * Supported methods
 *   total     – final = Σ over judges of (Σ criterion scores)
 *   average   – final = mean over judges of (Σ criterion scores)
 *   weighted  – judge score = Σ (score / maxScore × weight); final = mean over judges
 *   rank      – judges rank contestants directly; final = Σ ranks (lower is better)
 *   custom    – pluggable strategies (see CUSTOM_STRATEGY_REGISTRY):
 *                 trimmed_mean   – weighted, but the single highest and lowest judge scores
 *                                  are dropped when there are 3+ judges ("Olympic" scoring)
 *                 rank_of_scores – each judge's weighted scores are converted to ranks
 *                                  (fractional ranks on ties); final = Σ ranks (lower is better)
 *
 * Ranking compares final scores rounded to the category's decimal places.
 * Ties are never resolved by arbitrary ordering: configured tie-break rules are
 * applied in order; anything still tied shares the same rank (1, 2, 2, 4).
 */

// ---------------------------------------------------------------- helpers
export function round(value, dp = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value ?? null;
  return Number(`${Math.round(Number(`${value}e${dp}`))}e-${dp}`);
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const mean = (arr) => (arr.length ? sum(arr) / arr.length : null);
const id = (v) => (v === null || v === undefined ? v : String(v));

export const METHOD_LABELS = {
  total: 'Total Score',
  average: 'Average Score',
  weighted: 'Weighted Score',
  rank: 'Rank-Based',
  custom: 'Custom',
};

export const CUSTOM_STRATEGY_REGISTRY = {
  trimmed_mean: {
    label: 'Trimmed Mean (drop highest & lowest judge)',
    direction: 'desc',
    usesCriteria: true,
    final: ({ evals }) => {
      const values = evals.map((e) => e.weighted).sort((a, b) => a - b);
      const used = values.length >= 3 ? values.slice(1, -1) : values;
      return mean(used);
    },
  },
  rank_of_scores: {
    label: 'Rank of Scores (judge scores converted to ranks, lowest sum wins)',
    direction: 'asc',
    usesCriteria: true,
    needsDerivedRanks: true,
    final: ({ evals }) => sum(evals.map((e) => e.derivedRank)),
  },
};

export function directionFor(method, strategy) {
  if (method === 'rank') return 'asc';
  if (method === 'custom') return CUSTOM_STRATEGY_REGISTRY[strategy]?.direction || 'desc';
  return 'desc';
}

export function methodUsesCriteria(method) {
  return method !== 'rank';
}

export function methodLabel(method, strategy) {
  if (method === 'custom') return CUSTOM_STRATEGY_REGISTRY[strategy]?.label || 'Custom';
  return METHOD_LABELS[method] || method;
}

/** Fractional ("average") ranks: [90, 85, 85, 70] desc -> [1, 2.5, 2.5, 4]. */
export function fractionalRanks(items, getValue, direction = 'desc', dp = 4) {
  const sorted = [...items].sort((a, b) => (direction === 'desc' ? getValue(b) - getValue(a) : getValue(a) - getValue(b)));
  const ranks = new Map();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    const v = round(getValue(sorted[i]), dp);
    while (j + 1 < sorted.length && round(getValue(sorted[j + 1]), dp) === v) j += 1;
    const avg = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) ranks.set(sorted[k], avg);
    i = j + 1;
  }
  return ranks;
}

// ---------------------------------------------------------------- generic ranking with tie-breaks
/**
 * @param rows        rows with a numeric `key` (null = unranked)
 * @param direction   'desc' (higher wins) or 'asc' (lower wins)
 * @param evaluators  ordered tie-break evaluators: { label, direction, key(row) } or { shared: true }
 * @param dp          comparison precision
 */
export function rankWithTieBreaks(rows, direction, evaluators, dp, describe = (r) => r.name) {
  const better = (dir) => (a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return dir === 'desc' ? b - a : a - b;
  };
  const ranked = rows.filter((r) => r.key !== null && r.key !== undefined);
  const unranked = rows.filter((r) => r.key === null || r.key === undefined);

  // Display order inside an unresolved tie follows contestant number; it never affects rank.
  ranked.sort((a, b) => better(direction)(round(a.key, dp), round(b.key, dp)) || (a.number ?? 0) - (b.number ?? 0));

  const groups = [];
  for (const r of ranked) {
    const last = groups[groups.length - 1];
    if (last && round(last[0].key, dp) === round(r.key, dp)) last.push(r);
    else groups.push([r]);
  }

  const ties = [];
  const tiers = [];
  for (const group of groups) {
    if (group.length === 1) {
      tiers.push(group);
      continue;
    }
    const steps = [];
    const resolved = resolve(group, 0, steps);
    tiers.push(...resolved);
    ties.push({
      score: round(group[0].key, dp),
      contestants: group.map((r) => ({ contestantId: r.contestantId, number: r.number, name: r.name })),
      steps,
      resolved: resolved.every((t) => t.length === 1),
      sharedGroups: resolved
        .filter((t) => t.length > 1)
        .map((t) => t.map((r) => ({ contestantId: r.contestantId, number: r.number, name: r.name }))),
    });
  }

  function resolve(group, startIdx, steps) {
    if (group.length <= 1) return [group];
    for (let i = startIdx; i < evaluators.length; i += 1) {
      const ev = evaluators[i];
      if (ev.shared) {
        steps.push({ rule: 'Shared ranking', applied: true, separated: false });
        return [group];
      }
      const keyed = group.map((r) => ({ r, k: ev.key(r) }));
      if (keyed.every((x) => x.k === null || x.k === undefined)) continue; // rule not applicable
      keyed.sort((a, b) => better(ev.direction)(a.k === null ? null : round(a.k, dp), b.k === null ? null : round(b.k, dp)));
      const sub = [];
      for (const x of keyed) {
        const last = sub[sub.length - 1];
        const kx = x.k === null ? null : round(x.k, dp);
        if (last && last.k === kx) last.items.push(x.r);
        else sub.push({ k: kx, items: [x.r] });
      }
      if (sub.length === 1) {
        steps.push({ rule: ev.label, separated: false, values: keyed.map((x) => ({ name: describe(x.r), value: round(x.k, dp) })) });
        continue;
      }
      steps.push({ rule: ev.label, separated: true, values: keyed.map((x) => ({ name: describe(x.r), value: round(x.k, dp) })) });
      return sub.flatMap((s) => resolve(s.items, i + 1, steps));
    }
    return [group]; // nothing left: shared rank
  }

  let position = 1;
  for (const tier of tiers) {
    for (const r of tier) {
      r.rank = position;
      r.tied = tier.length > 1;
    }
    position += tier.length;
  }
  for (const r of unranked) {
    r.rank = null;
    r.tied = false;
  }

  // Human-readable notes
  for (const t of ties) {
    const who = t.contestants.map((c) => `#${c.number} ${c.name}`).join(', ');
    const decisive = t.steps.filter((s) => s.separated).map((s) => s.rule);
    t.note = t.resolved
      ? `Tie at ${t.score} between ${who} resolved by: ${decisive.join(' → ')}.`
      : decisive.length
        ? `Tie at ${t.score} between ${who} partially resolved by: ${decisive.join(' → ')}; remaining contestants share the rank.`
        : `Tie at ${t.score} between ${who} could not be resolved by the configured rules; contestants share the rank.`;
  }

  return { ordered: [...tiers.flat(), ...unranked], ties };
}

// ---------------------------------------------------------------- category tally
/**
 * @param {object} config  normalized snapshot:
 *   { scoringMethod, customStrategy, decimalPlaces,
 *     criteria:[{criterionId,name,weight,minScore,maxScore,order}],
 *     tieBreakRules:[{type,criterionId,judgeId}],
 *     judges:[{userId,name,order}], contestants:[{contestantId,number,name}] }
 * @param {Array} sheets   [{judge, contestant, scores:[{criterion,value}], rank, status}]
 */
export function computeCategoryTally(config, sheets) {
  const dp = Number.isInteger(config.decimalPlaces) ? config.decimalPlaces : 2;
  const method = config.scoringMethod;
  const strategyKey = method === 'custom' ? config.customStrategy : null;
  const strategy = strategyKey ? CUSTOM_STRATEGY_REGISTRY[strategyKey] : null;
  if (method === 'custom' && !strategy) throw new Error(`Unknown custom scoring strategy "${strategyKey}".`);

  const usesCriteria = methodUsesCriteria(method);
  const direction = directionFor(method, strategyKey);
  const criteria = [...(config.criteria || [])]
    .map((c) => ({ ...c, criterionId: id(c.criterionId) }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const judges = [...(config.judges || [])].map((j) => ({ ...j, userId: id(j.userId) })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const contestants = [...(config.contestants || [])]
    .map((c) => ({ ...c, contestantId: id(c.contestantId) }))
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  const sheetMap = new Map();
  for (const s of sheets) sheetMap.set(`${id(s.contestant)}|${id(s.judge)}`, s);

  const missing = [];
  const warnings = [];
  const evalMap = new Map(); // contestantId -> Map(judgeId -> evaluation)

  for (const c of contestants) {
    const perJudge = new Map();
    for (const j of judges) {
      const s = sheetMap.get(`${c.contestantId}|${j.userId}`);
      const base = { contestantId: c.contestantId, contestantNumber: c.number, contestantName: c.name, judgeId: j.userId, judgeName: j.name };
      if (!s) {
        missing.push({ ...base, reason: 'not_started' });
        continue;
      }
      if (s.status !== 'submitted') {
        missing.push({ ...base, reason: s.status === 'reopened' ? 'reopened' : 'draft' });
        continue;
      }
      if (usesCriteria) {
        const values = {};
        let complete = true;
        for (const cr of criteria) {
          const sc = (s.scores || []).find((x) => id(x.criterion) === cr.criterionId);
          if (!sc || !Number.isFinite(sc.value)) {
            complete = false;
            break;
          }
          values[cr.criterionId] = sc.value;
        }
        if (!complete) {
          missing.push({ ...base, reason: 'incomplete' });
          continue;
        }
        const raw = sum(criteria.map((cr) => values[cr.criterionId]));
        const weighted = sum(criteria.map((cr) => (cr.maxScore > 0 ? (values[cr.criterionId] / cr.maxScore) * cr.weight : 0)));
        perJudge.set(j.userId, { judgeId: j.userId, values, raw, weighted });
      } else {
        if (!Number.isFinite(s.rank)) {
          missing.push({ ...base, reason: 'incomplete' });
          continue;
        }
        perJudge.set(j.userId, { judgeId: j.userId, rank: s.rank });
      }
    }
    evalMap.set(c.contestantId, perJudge);
  }

  // Derived per-judge ranks (used by rank_of_scores and shown for every criteria-based method)
  if (usesCriteria) {
    for (const j of judges) {
      const scored = contestants.map((c) => evalMap.get(c.contestantId).get(j.userId)).filter(Boolean);
      const ranks = fractionalRanks(scored, (e) => e.weighted, 'desc', dp);
      for (const e of scored) e.derivedRank = ranks.get(e);
    }
  } else {
    // Validate rank uniqueness per judge (informational; submission already enforces it)
    for (const j of judges) {
      const ranks = contestants.map((c) => evalMap.get(c.contestantId).get(j.userId)?.rank).filter((r) => Number.isFinite(r));
      if (new Set(ranks).size !== ranks.length) warnings.push(`${j.name} has duplicate ranks.`);
    }
  }

  const rows = contestants.map((c) => {
    const perJudge = evalMap.get(c.contestantId);
    const evals = judges.map((j) => perJudge.get(j.userId)).filter(Boolean);
    let finalRaw = null;
    if (evals.length) {
      switch (method) {
        case 'total':
          finalRaw = sum(evals.map((e) => e.raw));
          break;
        case 'average':
          finalRaw = mean(evals.map((e) => e.raw));
          break;
        case 'weighted':
          finalRaw = mean(evals.map((e) => e.weighted));
          break;
        case 'rank':
          finalRaw = sum(evals.map((e) => e.rank));
          break;
        case 'custom':
          finalRaw = strategy.final({ evals });
          break;
        default:
          throw new Error(`Unsupported scoring method "${method}".`);
      }
    }

    const criterionAverages = usesCriteria
      ? criteria.map((cr) => {
          const vals = evals.map((e) => e.values[cr.criterionId]);
          const avg = mean(vals);
          return {
            criterionId: cr.criterionId,
            name: cr.name,
            average: avg === null ? null : round(avg, 4),
            weighted: avg === null || !cr.maxScore ? null : round((avg / cr.maxScore) * cr.weight, 4),
          };
        })
      : [];

    return {
      contestantId: c.contestantId,
      number: c.number,
      name: c.name,
      judgeScores: judges.map((j) => {
        const e = perJudge.get(j.userId);
        if (!e) return { judgeId: j.userId, submitted: false };
        return usesCriteria
          ? { judgeId: j.userId, submitted: true, raw: round(e.raw, 4), weighted: round(e.weighted, 4), derivedRank: e.derivedRank, values: e.values }
          : { judgeId: j.userId, submitted: true, rank: e.rank };
      }),
      criterionAverages,
      evaluatedBy: evals.length,
      complete: evals.length === judges.length,
      finalScoreRaw: finalRaw === null ? null : round(finalRaw, 6),
      finalScore: finalRaw === null ? null : round(finalRaw, dp),
      averageRank: method === 'rank' && evals.length ? round(finalRaw / evals.length, dp) : undefined,
      key: finalRaw === null ? null : finalRaw,
    };
  });

  // Tie-break evaluators built from the configured rules
  const evaluators = [];
  for (const rule of config.tieBreakRules || []) {
    if (rule.type === 'shared') {
      evaluators.push({ shared: true });
      break;
    }
    if (rule.type === 'highest_weight_criterion' || rule.type === 'criterion') {
      if (!usesCriteria || !criteria.length) continue;
      const crit =
        rule.type === 'criterion'
          ? criteria.find((c) => c.criterionId === id(rule.criterionId))
          : [...criteria].sort((a, b) => b.weight - a.weight || (a.order ?? 0) - (b.order ?? 0))[0];
      if (!crit) continue;
      evaluators.push({
        label:
          rule.type === 'criterion'
            ? `Highest average in "${crit.name}"`
            : `Highest average in "${crit.name}" (most important criterion, ${crit.weight}%)`,
        direction: 'desc',
        key: (r) => r.criterionAverages.find((x) => x.criterionId === crit.criterionId)?.average ?? null,
      });
    } else if (rule.type === 'judge') {
      const judge = judges.find((j) => j.userId === id(rule.judgeId));
      if (!judge) continue;
      const rankish = method === 'rank' || strategyKey === 'rank_of_scores';
      evaluators.push({
        label: rankish ? `Better placement from ${judge.name}` : `Higher score from ${judge.name}`,
        direction: rankish ? 'asc' : 'desc',
        key: (r) => {
          const js = r.judgeScores.find((x) => x.judgeId === judge.userId);
          if (!js?.submitted) return null;
          if (method === 'rank') return js.rank;
          if (strategyKey === 'rank_of_scores') return js.derivedRank;
          if (method === 'total' || method === 'average') return js.raw;
          return js.weighted;
        },
      });
    }
  }

  const { ordered, ties } = rankWithTieBreaks(rows, direction, evaluators, dp, (r) => `#${r.number} ${r.name}`);
  for (const r of ordered) delete r.key;

  const expected = contestants.length * judges.length;
  return {
    scoringMethod: method,
    customStrategy: strategyKey,
    methodLabel: methodLabel(method, strategyKey),
    direction,
    decimalPlaces: dp,
    judges: judges.map((j) => ({ judgeId: j.userId, name: j.name, order: j.order })),
    criteria: criteria.map((c) => ({ criterionId: c.criterionId, name: c.name, weight: c.weight, minScore: c.minScore, maxScore: c.maxScore, order: c.order })),
    rows: ordered,
    ties,
    missing,
    warnings,
    complete: expected > 0 && missing.length === 0,
    summary: {
      contestants: contestants.length,
      judges: judges.length,
      expectedSheets: expected,
      submittedSheets: expected - missing.length,
      missingSheets: missing.length,
    },
  };
}

/** Maximum attainable final score for a criteria-based category (used to normalize into an overall tally). */
export function maxPossibleScore(config) {
  const crit = config.criteria || [];
  const sumMax = sum(crit.map((c) => c.maxScore));
  switch (config.scoringMethod) {
    case 'total':
      return sumMax * (config.judges?.length || 0);
    case 'average':
      return sumMax;
    case 'weighted':
      return 100;
    case 'custom':
      return config.customStrategy === 'trimmed_mean' ? 100 : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- overall (multi-category) tally
/**
 * Combines several category tallies into one event-wide ranking.
 *   weighted : overall = Σ (category score normalized to 0–100 × category weight / 100)  (higher wins)
 *   rank_sum : overall = Σ category ranks                                              (lower wins)
 * @param parts [{ categoryId, name, weight, order, tally, maxPossible }]
 */
export function computeOverallTally({ parts, method, decimalPlaces = 2, contestants }) {
  const dp = decimalPlaces;
  const direction = method === 'rank_sum' ? 'asc' : 'desc';
  const warnings = [];
  const ordered = [...parts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (method === 'weighted') {
    const totalWeight = sum(ordered.map((p) => p.weight || 0));
    if (Math.abs(totalWeight - 100) > 1e-9) warnings.push(`Category weights total ${round(totalWeight, 2)}%, not 100%.`);
    for (const p of ordered) {
      if (!p.maxPossible) warnings.push(`"${p.name}" uses a rank-based method and cannot be weighted; use the Rank Sum overall method.`);
    }
  }

  const rows = contestants
    .map((c) => {
      const cid = id(c.contestantId);
      const categoryScores = ordered.map((p) => {
        const row = p.tally.rows.find((r) => r.contestantId === cid);
        if (!row) return { categoryId: id(p.categoryId), name: p.name, participated: false };
        const normalized = p.maxPossible && row.finalScoreRaw !== null ? (row.finalScoreRaw / p.maxPossible) * 100 : null;
        return {
          categoryId: id(p.categoryId),
          name: p.name,
          participated: true,
          finalScore: row.finalScore,
          rank: row.rank,
          normalized: normalized === null ? null : round(normalized, 4),
          contribution: normalized === null ? null : round((normalized * (p.weight || 0)) / 100, 4),
        };
      });
      const participated = categoryScores.filter((s) => s.participated);
      if (!participated.length) return null;
      let finalRaw = null;
      if (method === 'weighted') {
        finalRaw = sum(categoryScores.map((s) => s.contribution || 0));
      } else {
        finalRaw = sum(
          categoryScores.map((s, i) => {
            if (s.participated && Number.isFinite(s.rank)) return s.rank;
            // Not ranked in this category: placed after everyone who was
            return ordered[i].tally.rows.filter((r) => r.rank !== null).length + 1;
          })
        );
      }
      if (participated.length !== ordered.length) warnings.push(`#${c.number} ${c.name} did not compete in every included category.`);
      return { contestantId: cid, number: c.number, name: c.name, categoryScores, finalScoreRaw: round(finalRaw, 6), finalScore: round(finalRaw, dp), key: finalRaw };
    })
    .filter(Boolean);

  // Tie-break: better result in the most heavily weighted category, then shared
  const evaluators = [];
  const primary = [...ordered].sort((a, b) => (b.weight || 0) - (a.weight || 0) || (a.order ?? 0) - (b.order ?? 0))[0];
  if (primary) {
    evaluators.push({
      label: `Better result in "${primary.name}"`,
      direction: method === 'rank_sum' ? 'asc' : 'desc',
      key: (r) => {
        const s = r.categoryScores.find((x) => x.categoryId === id(primary.categoryId));
        if (!s?.participated) return null;
        return method === 'rank_sum' ? s.rank : s.normalized;
      },
    });
  }
  evaluators.push({ shared: true });

  const { ordered: rankedRows, ties } = rankWithTieBreaks(rows, direction, evaluators, dp, (r) => `#${r.number} ${r.name}`);
  for (const r of rankedRows) delete r.key;

  return {
    method,
    direction,
    decimalPlaces: dp,
    categories: ordered.map((p) => ({ categoryId: id(p.categoryId), name: p.name, weight: p.weight, complete: p.tally.complete })),
    rows: rankedRows,
    ties,
    warnings: [...new Set(warnings)],
    complete: ordered.length > 0 && ordered.every((p) => p.tally.complete),
  };
}
