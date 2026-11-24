import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCategoryTally, computeOverallTally, round, maxPossibleScore } from '../src/services/scoringEngine.js';

const crit = [
  { criterionId: 'c1', name: 'Creativity', weight: 30, minScore: 0, maxScore: 100, order: 1 },
  { criterionId: 'c2', name: 'Performance', weight: 40, minScore: 0, maxScore: 100, order: 2 },
  { criterionId: 'c3', name: 'Overall Impact', weight: 30, minScore: 0, maxScore: 100, order: 3 },
];
const judges = [
  { userId: 'j1', name: 'Judge A', order: 1 },
  { userId: 'j2', name: 'Judge B', order: 2 },
  { userId: 'j3', name: 'Judge C', order: 3 },
];
const contestants = [
  { contestantId: 'k1', number: 1, name: 'Ana' },
  { contestantId: 'k2', number: 2, name: 'Ben' },
  { contestantId: 'k3', number: 3, name: 'Cara' },
];
const sheet = (judge, contestant, v1, v2, v3, status = 'submitted') => ({
  judge,
  contestant,
  status,
  scores: [
    { criterion: 'c1', value: v1 },
    { criterion: 'c2', value: v2 },
    { criterion: 'c3', value: v3 },
  ],
});
const base = (over = {}) => ({
  scoringMethod: 'weighted',
  decimalPlaces: 2,
  criteria: crit,
  judges,
  contestants,
  tieBreakRules: [{ type: 'highest_weight_criterion' }, { type: 'shared' }],
  ...over,
});

const fullSheets = [
  sheet('j1', 'k1', 90, 80, 70),
  sheet('j2', 'k1', 80, 90, 85),
  sheet('j3', 'k1', 85, 85, 80),
  sheet('j1', 'k2', 70, 75, 80),
  sheet('j2', 'k2', 75, 70, 70),
  sheet('j3', 'k2', 80, 80, 75),
  sheet('j1', 'k3', 95, 90, 92),
  sheet('j2', 'k3', 90, 92, 88),
  sheet('j3', 'k3', 93, 91, 90),
];

test('round handles floating point edge cases', () => {
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round(84.4999, 2), 84.5);
  assert.equal(round(null, 2), null);
});

test('weighted method: Σ(score/max × weight), averaged over judges', () => {
  const t = computeCategoryTally(base(), fullSheets);
  assert.equal(t.complete, true);
  const ana = t.rows.find((r) => r.contestantId === 'k1');
  // j1: 27+32+21=80 ; j2: 24+36+25.5=85.5 ; j3: 25.5+34+24=83.5 ; mean=83
  assert.equal(ana.finalScore, 83);
  assert.deepEqual(t.rows.map((r) => r.name), ['Cara', 'Ana', 'Ben']);
  assert.deepEqual(t.rows.map((r) => r.rank), [1, 2, 3]);
});

test('total and average methods', () => {
  const total = computeCategoryTally(base({ scoringMethod: 'total' }), fullSheets);
  assert.equal(total.rows.find((r) => r.contestantId === 'k1').finalScore, 240 + 255 + 250);
  const avg = computeCategoryTally(base({ scoringMethod: 'average' }), fullSheets);
  assert.equal(avg.rows.find((r) => r.contestantId === 'k1').finalScore, round(745 / 3, 2));
});

test('rank method: lowest rank sum wins', () => {
  const r = (judge, contestant, rank) => ({ judge, contestant, rank, status: 'submitted', scores: [] });
  const sheets = [r('j1', 'k1', 1), r('j1', 'k2', 2), r('j1', 'k3', 3), r('j2', 'k1', 2), r('j2', 'k2', 1), r('j2', 'k3', 3), r('j3', 'k1', 1), r('j3', 'k2', 3), r('j3', 'k3', 2)];
  const t = computeCategoryTally(base({ scoringMethod: 'rank', criteria: [], tieBreakRules: [{ type: 'shared' }] }), sheets);
  assert.equal(t.direction, 'asc');
  assert.deepEqual(t.rows.map((x) => [x.name, x.finalScore, x.rank]), [
    ['Ana', 4, 1],
    ['Ben', 6, 2],
    ['Cara', 8, 3],
  ]);
});

test('custom trimmed mean drops highest and lowest judge', () => {
  const t = computeCategoryTally(base({ scoringMethod: 'custom', customStrategy: 'trimmed_mean' }), fullSheets);
  // Ana judge weighted scores 80, 85.5, 83.5 -> keep 83.5
  assert.equal(t.rows.find((r) => r.contestantId === 'k1').finalScore, 83.5);
});

test('custom rank_of_scores sums per-judge ranks', () => {
  const t = computeCategoryTally(base({ scoringMethod: 'custom', customStrategy: 'rank_of_scores' }), fullSheets);
  assert.equal(t.rows[0].name, 'Cara');
  assert.equal(t.rows[0].finalScore, 3);
});

test('ties are resolved by the highest-weight criterion, never by arbitrary order', () => {
  // Ana and Ben both reach weighted 80; Ben has the better Performance (40%) score
  const sheets = [
    { judge: 'j1', contestant: 'k1', status: 'submitted', scores: [{ criterion: 'c1', value: 100 }, { criterion: 'c2', value: 70 }, { criterion: 'c3', value: 73.33333333 }] },
    { judge: 'j1', contestant: 'k2', status: 'submitted', scores: [{ criterion: 'c1', value: 80 }, { criterion: 'c2', value: 80 }, { criterion: 'c3', value: 80 }] },
  ];
  const t = computeCategoryTally(base({ judges: [judges[0]], contestants: contestants.slice(0, 2) }), sheets);
  assert.equal(t.rows[0].name, 'Ben');
  assert.equal(t.rows[0].rank, 1);
  assert.equal(t.rows[1].rank, 2);
  assert.equal(t.ties.length, 1);
  assert.equal(t.ties[0].resolved, true);
});

test('unresolvable ties share the rank (1, 1, 3)', () => {
  const sheets = [sheet('j1', 'k1', 80, 80, 80), sheet('j1', 'k2', 80, 80, 80), sheet('j1', 'k3', 70, 70, 70)];
  const t = computeCategoryTally(base({ judges: [judges[0]] }), sheets);
  assert.deepEqual(t.rows.map((r) => r.rank), [1, 1, 3]);
  assert.equal(t.rows[0].tied, true);
  assert.equal(t.ties[0].resolved, false);
});

test('judge tie-break rule', () => {
  const sheets = [sheet('j1', 'k1', 90, 90, 90), sheet('j2', 'k1', 70, 70, 70), sheet('j1', 'k2', 70, 70, 70), sheet('j2', 'k2', 90, 90, 90)];
  const t = computeCategoryTally(
    base({ judges: judges.slice(0, 2), contestants: contestants.slice(0, 2), tieBreakRules: [{ type: 'highest_weight_criterion' }, { type: 'judge', judgeId: 'j2' }, { type: 'shared' }] }),
    sheets
  );
  assert.equal(t.rows[0].name, 'Ben');
  assert.equal(t.ties[0].resolved, true);
});

test('missing, draft and incomplete sheets are reported and block completeness', () => {
  const sheets = [...fullSheets.slice(0, 7), sheet('j2', 'k3', 90, 92, 88, 'draft'), { judge: 'j3', contestant: 'k3', status: 'submitted', scores: [{ criterion: 'c1', value: 1 }] }];
  const t = computeCategoryTally(base(), sheets);
  assert.equal(t.complete, false);
  assert.deepEqual(t.missing.map((m) => m.reason).sort(), ['draft', 'incomplete']);
  assert.equal(t.rows.find((r) => r.contestantId === 'k3').complete, false);
});

test('overall weighted tally normalizes category scores', () => {
  const cfgA = base();
  const cfgB = base({ scoringMethod: 'average' });
  const a = computeCategoryTally(cfgA, fullSheets);
  const b = computeCategoryTally(cfgB, fullSheets);
  const o = computeOverallTally({
    method: 'weighted',
    contestants,
    parts: [
      { categoryId: 'A', name: 'A', weight: 60, order: 1, tally: a, maxPossible: maxPossibleScore(cfgA) },
      { categoryId: 'B', name: 'B', weight: 40, order: 2, tally: b, maxPossible: maxPossibleScore(cfgB) },
    ],
  });
  assert.equal(o.complete, true);
  assert.equal(o.rows[0].name, 'Cara');
  assert.equal(o.warnings.length, 0);
});
