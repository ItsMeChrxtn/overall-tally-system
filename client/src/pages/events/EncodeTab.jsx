import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, Info, Keyboard, Lock, RotateCcw, Save, Send, UserCheck } from 'lucide-react';
import api from '../../api/client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, ProgressBar, Select, TableSkeleton, cx } from '../../components/ui';
import { decimalsOf, num } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const STATUS = {
  submitted: { label: 'Submitted', tone: 'green', icon: CheckCircle2 },
  draft: { label: 'Draft', tone: 'amber', icon: CircleDashed },
  reopened: { label: 'Reopened', tone: 'red', icon: RotateCcw },
  none: { label: 'Blank', tone: 'gray', icon: CircleDashed },
};

function cellError(raw, c) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const v = Number(raw);
  if (Number.isNaN(v)) return 'Not a number';
  if (v < c.minScore || v > c.maxScore) return `Allowed ${c.minScore}–${c.maxScore}`;
  if (decimalsOf(raw) > (c.decimalPlaces ?? 2)) return `Max ${c.decimalPlaces} decimals`;
  return null;
}

/** Initial grid values for one judge, from their saved sheets. */
function gridFor(data, judgeId) {
  const out = {};
  for (const c of data.contestants) {
    const s = data.sheets.find((x) => String(x.judge) === String(judgeId) && String(x.contestant) === String(c._id));
    out[c._id] = data.category.usesCriteria
      ? Object.fromEntries(data.criteria.map((cr) => [cr.criterionId, s?.scores?.find((v) => String(v.criterion) === String(cr.criterionId))?.value ?? '']))
      : { rank: s?.rank ?? '' };
  }
  return out;
}

/** One judge's paper score sheet, entered as a grid: contestants × criteria. */
function JudgeSheet({ data, judge, reload }) {
  const { category, criteria, contestants } = data;
  const sheetOf = useCallback((cid) => data.sheets.find((x) => String(x.judge) === String(judge.userId) && String(x.contestant) === String(cid)), [data.sheets, judge.userId]);
  const [grid, setGrid] = useState(() => gridFor(data, judge.userId));
  const [dirty, setDirty] = useState(() => new Set());
  const [busy, setBusy] = useState('');
  const inputs = useRef([]);

  useEffect(() => {
    setGrid(gridFor(data, judge.userId));
    setDirty(new Set());
  }, [data, judge.userId]);

  const locked = (cid) => sheetOf(cid)?.status === 'submitted' || !category.scoringOpen;
  const allSubmitted = contestants.length > 0 && contestants.every((c) => sheetOf(c._id)?.status === 'submitted');

  const set = (cid, key, value) => {
    setGrid((g) => ({ ...g, [cid]: { ...g[cid], [key]: value } }));
    setDirty((d) => new Set(d).add(String(cid)));
  };

  const errors = useMemo(() => {
    const e = {};
    if (category.usesCriteria) {
      for (const c of contestants) for (const cr of criteria) {
        const msg = cellError(grid[c._id]?.[cr.criterionId], cr);
        if (msg) e[`${c._id}:${cr.criterionId}`] = msg;
      }
    } else {
      const ranks = contestants.map((c) => grid[c._id]?.rank).filter((r) => r !== '');
      const dup = ranks.filter((r, i) => ranks.indexOf(r) !== i);
      for (const c of contestants) if (grid[c._id]?.rank !== '' && dup.includes(grid[c._id]?.rank)) e[`${c._id}:rank`] = 'Rank used twice';
    }
    return e;
  }, [grid, contestants, criteria, category.usesCriteria]);
  const hasErrors = Object.keys(errors).length > 0;

  const rowPreview = (cid) => {
    const vals = criteria.map((cr) => grid[cid]?.[cr.criterionId]);
    if (vals.some((v) => v === '' || v === undefined) || criteria.some((cr) => errors[`${cid}:${cr.criterionId}`])) return null;
    return {
      total: criteria.reduce((a, cr) => a + Number(grid[cid][cr.criterionId]), 0),
      weighted: criteria.reduce((a, cr) => a + (Number(grid[cid][cr.criterionId]) / cr.maxScore) * cr.weight, 0),
    };
  };
  const complete = category.usesCriteria
    ? contestants.every((c) => locked(c._id) || rowPreview(c._id))
    : contestants.every((c) => grid[c._id]?.rank !== '') && !hasErrors;

  const payloadFor = (cid) =>
    category.usesCriteria
      ? { scores: criteria.filter((cr) => grid[cid][cr.criterionId] !== '').map((cr) => ({ criterion: cr.criterionId, value: Number(grid[cid][cr.criterionId]) })) }
      : { rank: grid[cid].rank === '' ? null : Number(grid[cid].rank) };

  const saveDrafts = async ({ silent = false } = {}) => {
    if (hasErrors) {
      showError({ response: { data: { message: 'Fix the highlighted cells first.' } } }, 'Invalid scores');
      return false;
    }
    const ids = contestants.filter((c) => dirty.has(String(c._id)) && !locked(c._id)).map((c) => c._id);
    if (!ids.length) {
      if (!silent) toast.info('Nothing new to save');
      return true;
    }
    setBusy('save');
    try {
      for (const cid of ids) await api.put(`/categories/${category._id}/encode/${judge.userId}/sheets/${cid}`, payloadFor(cid));
      setDirty(new Set());
      if (!silent) toast.success(`Saved ${ids.length} sheet(s) as draft`);
      await reload();
      return true;
    } catch (err) {
      showError(err, 'Could not save');
      return false;
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    if (!complete) return showError({ response: { data: { message: category.usesCriteria ? 'Fill in every score for every contestant first.' : `Give every contestant a unique rank from 1 to ${contestants.length}.` } } }, 'Incomplete sheet');
    if (!(await confirmAction({ title: `Submit ${judge.name}'s score sheet?`, text: 'Double-check the scores against the paper sheet. Once submitted, they are locked and can only be changed through Reopen for correction.', confirmText: 'Submit & lock' }))) return;
    setBusy('submit');
    try {
      const pending = contestants.filter((c) => !locked(c._id));
      await api.post(`/categories/${category._id}/encode/${judge.userId}/submit-all`, { sheets: pending.map((c) => ({ contestant: c._id, ...payloadFor(c._id) })) });
      toast.success(`${judge.name}: score sheet submitted`);
      await reload();
    } catch (err) {
      showError(err, 'Submission failed');
    } finally {
      setBusy('');
    }
  };

  // Enter moves to the next cell (row by row, like reading the paper sheet)
  const onKey = (e, i) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = inputs.current.slice(i + 1).find((el) => el && !el.disabled);
    if (next) {
      next.focus();
      next.select?.();
    }
  };
  inputs.current = [];
  let idx = -1;

  const reopened = contestants.filter((c) => sheetOf(c._id)?.status === 'reopened');

  return (
    <Card>
      <CardHeader
        title={`Seat ${judge.order} · ${judge.name}`}
        description={allSubmitted ? 'All sheets for this judge are submitted and locked.' : category.usesCriteria ? 'Type the scores from this judge\'s paper sheet. Press Enter to jump to the next cell.' : 'Enter this judge\'s ranking (1 = best).'}
        actions={allSubmitted && <Badge tone="green" dot>Submitted</Badge>}
      />
      {reopened.length > 0 && (
        <div className="px-5 pt-4">
          <Alert tone="red" icon={RotateCcw} title="Reopened for correction">
            {reopened.map((c) => `#${c.number} ${c.name}: ${sheetOf(c._id).reopenReason || 'no reason given'}`).join(' · ')}
          </Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th className="min-w-44">Contestant</th>
              {category.usesCriteria ? (
                criteria.map((cr) => (
                  <th key={cr.criterionId} className="min-w-28 text-right" title={cr.description || ''}>
                    <span className="block leading-tight">{cr.name}</span>
                    <span className="block text-[11px] font-normal text-ink-400">
                      {cr.minScore}–{cr.maxScore}
                      {cr.weight ? ` · ${cr.weight}%` : ''}
                    </span>
                  </th>
                ))
              ) : (
                <th className="w-32 text-right">Rank</th>
              )}
              {category.usesCriteria && <th className="w-24 text-right">Total</th>}
              <th className="w-28">Status</th>
            </tr>
          </thead>
          <tbody>
            {contestants.map((c) => {
              const s = sheetOf(c._id);
              const st = STATUS[s?.status || 'none'];
              const ro = locked(c._id);
              const pv = category.usesCriteria ? rowPreview(c._id) : null;
              return (
                <tr key={c._id} className={cx(ro && 'bg-ink-50/60')}>
                  <td className="font-semibold text-ink-500 tabular-nums">{c.number}</td>
                  <td>
                    <p className="font-medium text-ink-800">{c.name}</p>
                    {c.representing && <p className="text-xs text-ink-500">{c.representing}</p>}
                  </td>
                  {category.usesCriteria ? (
                    criteria.map((cr) => {
                      const i = ++idx;
                      const err = errors[`${c._id}:${cr.criterionId}`];
                      return (
                        <td key={cr.criterionId} className="text-right">
                          <input
                            ref={(el) => (inputs.current[i] = el)}
                            type="number"
                            inputMode="decimal"
                            min={cr.minScore}
                            max={cr.maxScore}
                            step={cr.decimalPlaces ? 1 / 10 ** cr.decimalPlaces : 1}
                            disabled={ro}
                            value={grid[c._id]?.[cr.criterionId] ?? ''}
                            onChange={(e) => set(c._id, cr.criterionId, e.target.value)}
                            onKeyDown={(e) => onKey(e, i)}
                            onFocus={(e) => e.target.select()}
                            title={err || ''}
                            className={cx(
                              'h-9 w-24 rounded-md border px-2 text-right text-sm font-semibold tabular-nums focus:ring-2 focus:outline-none disabled:border-transparent disabled:bg-transparent disabled:text-ink-600',
                              err ? 'border-red-400 bg-red-50 focus:ring-red-200' : 'border-ink-300 focus:border-brand-500 focus:ring-brand-500/20'
                            )}
                          />
                        </td>
                      );
                    })
                  ) : (
                    <td className="text-right">
                      <select
                        disabled={ro}
                        value={grid[c._id]?.rank ?? ''}
                        onChange={(e) => set(c._id, 'rank', e.target.value)}
                        className={cx('h-9 w-24 rounded-md border px-2 text-sm', errors[`${c._id}:rank`] ? 'border-red-400 bg-red-50' : 'border-ink-300')}
                      >
                        <option value="">—</option>
                        {contestants.map((_, k) => (
                          <option key={k} value={k + 1}>
                            {k + 1}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {category.usesCriteria && <td className="text-right font-semibold tabular-nums text-ink-800">{pv ? num(pv.total) : <span className="text-ink-300">—</span>}</td>}
                  <td>
                    <Badge tone={st.tone} dot>
                      {st.label}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasErrors && (
        <p className="border-t border-ink-100 px-5 py-2 text-xs text-red-600">
          {Object.values(errors)[0]} — hover a red cell for details.
        </p>
      )}
      {!allSubmitted && category.scoringOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/70 px-5 py-4">
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <Keyboard className="size-3.5" /> Totals here are a preview; official scores are computed by the server.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" icon={Save} onClick={() => saveDrafts()} loading={busy === 'save'} disabled={!dirty.size}>
              Save draft
            </Button>
            <Button icon={Send} onClick={submit} loading={busy === 'submit'} disabled={!complete || hasErrors}>
              Submit this sheet
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function EncodeTab() {
  const { event } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const categoryId = params.get('category') || '';
  const judgeId = params.get('judge') || '';

  useEffect(() => {
    api
      .get(`/events/${event._id}/categories`)
      .then(({ data: d }) => {
        setCategories(d.items);
        if (!categoryId && d.items.length) setParams({ category: (d.items.find((c) => c.configLocked) || d.items[0])._id }, { replace: true });
      })
      .catch((err) => {
        setCategories([]);
        showError(err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event._id]);

  const load = useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    try {
      const { data: d } = await api.get(`/categories/${categoryId}/encode`);
      setData(d);
    } catch (err) {
      setData(null);
      showError(err);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEventSocket(event._id, {
    'category:updated': (p) => p?.categoryId === categoryId && load(),
    'sheet:reopened': (p) => p?.categoryId === categoryId && load(),
    'assignments:updated': load,
    // Judges scoring on their own devices: keep their progress current
    'sheet:submitted': (p) => p?.categoryId === categoryId && data?.judges?.some((j) => j.selfScoring && String(j.userId) === String(p.judgeId)) && load(),
  });

  const judges = data?.judges || [];
  const judge = judges.find((j) => String(j.userId) === judgeId) || judges[0];
  const judgeProgress = (j) => (data ? data.sheets.filter((s) => String(s.judge) === String(j.userId) && s.status === 'submitted').length : 0);

  if (categories === null) return <Card><TableSkeleton /></Card>;
  if (!categories.length) return <Card><EmptyState title="No categories yet" description="Add a category and its criteria first." /></Card>;

  return (
    <div className="space-y-5">
      <Card padded>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Category" className="w-full sm:w-80">
            <Select value={categoryId} onChange={(e) => setParams({ category: e.target.value })}>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                  {c.configLocked ? '' : ' (not open yet)'}
                </option>
              ))}
            </Select>
          </Field>
          {data?.category && <p className="pb-2 text-sm text-ink-500">{data.category.methodLabel}</p>}
        </div>
        {judges.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-sm font-medium text-ink-700">Judge's score sheet</p>
            <div className="flex flex-wrap gap-2">
              {judges.map((j) => {
                const done = judgeProgress(j);
                const active = String(j.userId) === String(judge?.userId);
                return (
                  <button
                    key={j.userId}
                    type="button"
                    onClick={() => setParams({ category: categoryId, judge: j.userId })}
                    className={cx('min-w-40 rounded-lg border px-3 py-2 text-left transition-colors', active ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 hover:bg-ink-50')}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs text-ink-500">
                      Seat {j.order}
                      {j.selfScoring && <Badge tone="green">Self-scoring</Badge>}
                    </span>
                    <span className="block truncate text-sm font-medium text-ink-800">{j.name}</span>
                    <span className="mt-1 flex items-center gap-2">
                      <ProgressBar value={done} max={data.contestants.length || 1} className="flex-1" />
                      <span className="text-[11px] text-ink-500 tabular-nums">
                        {done}/{data.contestants.length}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {data?.category?.instructions && (
        <Alert tone="blue" icon={Info} title="Instructions">
          {data.category.instructions}
        </Alert>
      )}

      {loading && !data ? (
        <Card><TableSkeleton /></Card>
      ) : !data ? null : !data.category.configLocked ? (
        <Card>
          <EmptyState
            icon={Lock}
            title="Scoring is not open for this category"
            description="Add the contestants and judges, then press “Lock & open scoring” on the category page. You can encode scores after that."
            action={<Link to={`/app/events/${event._id}/categories/${categoryId}`} className="text-sm font-medium text-brand-600">Open category setup</Link>}
          />
        </Card>
      ) : !data.category.scoringOpen ? (
        <Alert tone="gray" icon={Lock} title="Scoring is closed">
          This category is closed. Reopen scoring on the category page to encode more scores.
        </Alert>
      ) : null}

      {data?.category?.configLocked && judge?.selfScoring && (
        <Alert tone="green" icon={UserCheck} title={`${judge.name} scores their own sheets`}>
          This judge has their own sign-in and enters their scores per criterion themselves. Their progress above updates as they submit. To encode for them instead, turn off their sign-in in the Judges tab.
        </Alert>
      )}
      {data?.category?.configLocked && judge && !judge.selfScoring && <JudgeSheet key={`${categoryId}:${judge.userId}`} data={data} judge={judge} reload={load} />}
    </div>
  );
}
