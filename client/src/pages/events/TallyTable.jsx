import { Avatar, Badge, cx } from '../../components/ui';
import { num } from '../../lib/format';

const RANKISH = (t) => t.scoringMethod === 'rank' || t.customStrategy === 'rank_of_scores';

function judgeCell(js, t, dp) {
  if (!js?.submitted) return <span className="text-slate-300">—</span>;
  if (t.scoringMethod === 'rank') return <span className="tabular-nums">{js.rank}</span>;
  const main = t.scoringMethod === 'total' || t.scoringMethod === 'average' ? js.raw : js.weighted;
  return (
    <span className="tabular-nums">
      {num(main, dp)}
      {t.customStrategy === 'rank_of_scores' && <span className="ml-1 text-[11px] text-slate-400">r{js.derivedRank}</span>}
    </span>
  );
}

function RankCell({ row }) {
  if (row.rank === null || row.rank === undefined) return <span className="text-slate-300">—</span>;
  return (
    <span className={cx('inline-flex min-w-8 items-center justify-center rounded-md px-1.5 py-0.5 text-sm font-semibold tabular-nums', row.rank === 1 ? 'bg-amber-100 text-amber-800' : row.rank <= 3 ? 'bg-slate-100 text-slate-800' : 'text-slate-700')}>
      {row.rank}
      {row.tied && <span className="ml-1 text-[10px] font-medium text-amber-600">T</span>}
    </span>
  );
}

/**
 * Renders a category tally (live or saved). Columns adapt to the configured judges and criteria.
 * mode: 'judges' (judge scores) | 'criteria' (criterion averages + weighted)
 */
export function CategoryTallyTable({ tally, extras = {}, mode = 'judges' }) {
  const dp = tally.decimalPlaces ?? 2;
  const usesCriteria = tally.scoringMethod !== 'rank';
  const showCriteria = mode === 'criteria' && usesCriteria;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-16 text-center">Rank</th>
            <th className="w-14 text-center">No.</th>
            <th className="min-w-48">Contestant</th>
            {!showCriteria &&
              tally.judges.map((j, i) => (
                <th key={j.judgeId} className="text-right" title={j.name}>
                  <span className="block text-[10px] font-medium text-slate-400 normal-case">Judge {j.order || i + 1}</span>
                  {j.name.split(' ').slice(-1)[0]}
                </th>
              ))}
            {showCriteria &&
              tally.criteria.map((c) => (
                <th key={c.criterionId} className="text-right" colSpan={1}>
                  <span className="block text-[10px] font-medium text-slate-400 normal-case">
                    {c.weight}% · max {c.maxScore}
                  </span>
                  {c.name}
                </th>
              ))}
            {showCriteria && <th className="text-right">Σ Weighted</th>}
            <th className="text-right">{RANKISH(tally) ? 'Rank sum' : 'Final score'}</th>
          </tr>
        </thead>
        <tbody>
          {tally.rows.map((r) => (
            <tr key={r.contestantId} className={cx(!r.complete && 'bg-amber-50/40')}>
              <td className="text-center">
                <RankCell row={r} />
              </td>
              <td className="text-center text-slate-500 tabular-nums">{r.number}</td>
              <td>
                <div className="flex items-center gap-2.5">
                  <Avatar name={r.name} src={extras[r.contestantId]?.photo} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{r.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {extras[r.contestantId]?.representing}
                      {!r.complete && <span className="ml-1 text-amber-600">· {r.evaluatedBy}/{tally.judges.length} judges</span>}
                    </p>
                  </div>
                </div>
              </td>
              {!showCriteria &&
                tally.judges.map((j) => (
                  <td key={j.judgeId} className="text-right">
                    {judgeCell(
                      r.judgeScores.find((x) => String(x.judgeId) === String(j.judgeId)),
                      tally,
                      dp
                    )}
                  </td>
                ))}
              {showCriteria &&
                tally.criteria.map((c) => {
                  const ca = r.criterionAverages.find((x) => String(x.criterionId) === String(c.criterionId));
                  return (
                    <td key={c.criterionId} className="text-right tabular-nums">
                      {num(ca?.average, dp)}
                      <span className="block text-[11px] text-slate-400">{num(ca?.weighted, dp)} pts</span>
                    </td>
                  );
                })}
              {showCriteria && <td className="text-right text-slate-600 tabular-nums">{num(r.criterionAverages.reduce((a, c) => a + (c.weighted || 0), 0), dp)}</td>}
              <td className="text-right text-base font-semibold text-slate-900 tabular-nums">{num(r.finalScore, dp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverallTallyTable({ tally, extras = {} }) {
  const dp = tally.decimalPlaces ?? 2;
  const categories = tally.categories || tally.criteria || [];
  const rankSum = (tally.method || tally.scoringMethod || '').includes('rank');
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-16 text-center">Rank</th>
            <th className="w-14 text-center">No.</th>
            <th className="min-w-48">Contestant</th>
            {categories.map((c) => (
              <th key={c.categoryId} className="text-right">
                <span className="block text-[10px] font-medium text-slate-400 normal-case">{rankSum ? 'rank' : `${c.weight}% weight`}</span>
                {c.name}
              </th>
            ))}
            <th className="text-right">{rankSum ? 'Rank sum' : 'Overall score'}</th>
          </tr>
        </thead>
        <tbody>
          {tally.rows.map((r) => (
            <tr key={r.contestantId}>
              <td className="text-center">
                <RankCell row={r} />
              </td>
              <td className="text-center text-slate-500 tabular-nums">{r.number}</td>
              <td>
                <div className="flex items-center gap-2.5">
                  <Avatar name={r.name} src={extras[r.contestantId]?.photo} size="sm" />
                  <span className="font-medium text-slate-800">{r.name}</span>
                </div>
              </td>
              {categories.map((c) => {
                const s = r.categoryScores.find((x) => String(x.categoryId) === String(c.categoryId));
                if (!s?.participated) return <td key={c.categoryId} className="text-right text-slate-300">—</td>;
                return (
                  <td key={c.categoryId} className="text-right tabular-nums">
                    {rankSum ? s.rank ?? '—' : num(s.normalized, dp)}
                    {!rankSum && <span className="block text-[11px] text-slate-400">+{num(s.contribution, dp)} · rank {s.rank ?? '—'}</span>}
                  </td>
                );
              })}
              <td className="text-right text-base font-semibold tabular-nums">{num(r.finalScore, dp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TiesPanel({ ties }) {
  if (!ties?.length) return null;
  return (
    <div className="space-y-2">
      {ties.map((t, i) => (
        <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={t.resolved ? 'green' : 'amber'}>{t.resolved ? 'Resolved' : 'Shared rank'}</Badge>
            <span className="text-amber-900">{t.note}</span>
          </div>
          {t.steps?.filter((s) => s.values).length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-900/80">
              {t.steps
                .filter((s) => s.values)
                .map((s, k) => (
                  <li key={k}>
                    <span className="font-medium">{s.rule}:</span> {s.values.map((v) => `${v.name} = ${v.value ?? '—'}`).join(', ')}
                    {!s.separated && ' (still tied)'}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export function MissingPanel({ missing }) {
  if (!missing?.length) return null;
  const reason = { not_started: 'not started', draft: 'draft (not submitted)', reopened: 'reopened for correction', incomplete: 'incomplete' };
  return (
    <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
      {missing.map((m, i) => (
        <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-1.5 ring-1 ring-amber-200">
          <span className="truncate">
            <span className="font-medium">{m.judgeName}</span> → #{m.contestantNumber} {m.contestantName}
          </span>
          <span className="shrink-0 text-xs text-amber-700">{reason[m.reason] || m.reason}</span>
        </li>
      ))}
    </ul>
  );
}
