import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, Copy, Lock, LockOpen, Pause, Pencil, Play, Plus, Save, ShieldAlert, Trash2, TriangleAlert, X } from 'lucide-react';
import api from '../../api/client';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Modal, PageSkeleton, Select, Textarea, Toggle, cx } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { SCORING_METHODS, TIE_RULES, formatDateTime } from '../../lib/format';
import { confirmAction, promptReason, showError, showMessage, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';
import CategoryForm, { CUSTOM_STRATEGIES, validateCategory } from './CategoryForm';

const emptyCriterion = { name: '', description: '', weight: '', minScore: 0, maxScore: 100, decimalPlaces: 2, isActive: true };

function validateCriterion(c) {
  const e = {};
  if (!c.name || c.name.trim().length < 2) e.name = 'Name is required.';
  const w = Number(c.weight);
  if (c.weight === '' || Number.isNaN(w)) e.weight = 'Enter a weight.';
  else if (w < 0) e.weight = 'Weight cannot be negative.';
  else if (w > 100) e.weight = 'Weight cannot exceed 100%.';
  const min = Number(c.minScore);
  const max = Number(c.maxScore);
  if (Number.isNaN(min) || min < 0) e.minScore = 'Minimum cannot be negative.';
  if (Number.isNaN(max) || max <= 0) e.maxScore = 'Maximum must be greater than 0.';
  else if (max <= min) e.maxScore = 'Maximum must be greater than the minimum.';
  return e;
}

/** Ordered tie-break rule editor. */
function TieRulesEditor({ rules, onChange, criteria, judges, disabled, usesCriteria }) {
  const update = (i, patch) => onChange(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (i, d) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const hasShared = rules.some((r) => r.type === 'shared');
  return (
    <div className="space-y-2">
      {rules.length === 0 && <p className="text-sm text-ink-500">No rules — tied contestants will share the rank.</p>}
      {rules.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-200 bg-ink-50/60 p-2">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-ink-600 ring-1 ring-ink-200">{i + 1}</span>
          <Select disabled={disabled} value={r.type} onChange={(e) => update(i, { type: e.target.value, criterion: null, judge: null })} className="min-w-0 flex-1 sm:max-w-sm">
            {TIE_RULES.filter((t) => usesCriteria || !t.value.includes('criterion')).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          {r.type === 'criterion' && (
            <Select disabled={disabled} value={r.criterion || ''} onChange={(e) => update(i, { criterion: e.target.value })} className="w-full sm:w-48">
              <option value="">Choose criterion…</option>
              {criteria.filter((c) => c.isActive).map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {r.type === 'judge' && (
            <Select disabled={disabled} value={r.judge || ''} onChange={(e) => update(i, { judge: e.target.value })} className="w-full sm:w-48">
              <option value="">Choose judge…</option>
              {judges.map((j) => (
                <option key={j.userId} value={j.userId}>
                  {j.name}
                </option>
              ))}
            </Select>
          )}
          {!disabled && (
            <div className="ml-auto flex">
              <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon={ArrowDown} label="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon={X} label="Remove rule" onClick={() => onChange(rules.filter((_, k) => k !== i))} />
            </div>
          )}
        </div>
      ))}
      {!disabled && !hasShared && (
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => onChange([...rules, { type: usesCriteria ? 'criterion' : 'judge' }])}>
          Add rule
        </Button>
      )}
    </div>
  );
}

/** Checkbox picker used for contestants and judges. */
function Picker({ items, selected, onChange, disabled, render, empty }) {
  const all = items.length > 0 && items.every((i) => selected.includes(i.id));
  if (!items.length) return <p className="px-5 py-6 text-sm text-ink-500">{empty}</p>;
  return (
    <div>
      {!disabled && (
        <label className="flex items-center gap-2 border-b border-ink-100 px-5 py-2 text-xs font-medium text-ink-500">
          <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : items.map((i) => i.id))} className="rounded border-ink-300" /> Select all
        </label>
      )}
      <ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto">
        {items.map((i) => (
          <li key={i.id}>
            <label className={cx('flex items-center gap-3 px-5 py-2', disabled ? 'cursor-default' : 'cursor-pointer hover:bg-ink-50')}>
              <input type="checkbox" disabled={disabled} checked={selected.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))} className="rounded border-ink-300 text-brand-600" />
              {render(i)}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CategoryDetail() {
  const { categoryId } = useParams();
  const { event, can, reload: reloadEvent } = useOutletContext();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [eventContestants, setEventContestants] = useState([]);
  const [eventJudges, setEventJudges] = useState([]);
  const [otherCategories, setOtherCategories] = useState([]);
  const [scoring, setScoring] = useState(null);
  const [selContestants, setSelContestants] = useState([]);
  const [selJudges, setSelJudges] = useState([]);
  const [overall, setOverall] = useState({ includeInOverall: false, overallWeight: 0 });
  const [awardees, setAwardees] = useState(3);
  const [critModal, setCritModal] = useState(null);
  const [critErrors, setCritErrors] = useState({});
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [cat, cons, asg, cats] = await Promise.all([
        api.get(`/categories/${categoryId}`),
        api.get(`/events/${event._id}/contestants`),
        api.get(`/events/${event._id}/assignments`),
        api.get(`/events/${event._id}/categories`),
      ]);
      const d = cat.data;
      setData(d);
      setScoring({ scoringMethod: d.category.scoringMethod, customStrategy: d.category.customStrategy || 'trimmed_mean', decimalPlaces: d.category.decimalPlaces, tieBreakRules: d.category.tieBreakRules.map((r) => ({ type: r.type, criterion: r.criterion || null, judge: r.judge || null })) });
      setSelContestants(d.category.contestants.map(String));
      setSelJudges(d.judges.map((j) => String(j.userId)));
      setOverall({ includeInOverall: d.category.includeInOverall, overallWeight: d.category.overallWeight });
      setAwardees(d.category.awardees ?? 3);
      setEventContestants(cons.data.items);
      setEventJudges(asg.data.items.filter((a) => a.role === 'judge'));
      setOtherCategories(cats.data.items.filter((c) => c._id !== categoryId));
    } catch (err) {
      showError(err, 'Could not load category');
    }
  }, [categoryId, event._id]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEventSocket(event._id, { 'category:updated': (p) => p.categoryId === categoryId && !busy && load() });

  const category = data?.category;
  const locked = !!category?.configLocked;
  const editable = can.manage && event.status !== 'archived';
  const configEditable = editable && !locked;
  const usesCriteria = scoring?.scoringMethod !== 'rank';
  const needsWeights = ['weighted', 'custom'].includes(scoring?.scoringMethod);
  const activeCriteria = useMemo(() => (data?.criteria || []).filter((c) => c.isActive), [data]);
  const totalWeight = +activeCriteria.reduce((a, c) => a + c.weight, 0).toFixed(4);

  const dirtyScoring =
    category &&
    scoring &&
    (scoring.scoringMethod !== category.scoringMethod ||
      (scoring.scoringMethod === 'custom' && scoring.customStrategy !== category.customStrategy) ||
      scoring.decimalPlaces !== category.decimalPlaces ||
      JSON.stringify(scoring.tieBreakRules) !== JSON.stringify(category.tieBreakRules.map((r) => ({ type: r.type, criterion: r.criterion || null, judge: r.judge || null }))));
  const dirtyContestants = category && JSON.stringify([...selContestants].sort()) !== JSON.stringify(category.contestants.map(String).sort());
  const dirtyJudges = data && JSON.stringify([...selJudges].sort()) !== JSON.stringify(data.judges.map((j) => String(j.userId)).sort());

  const run = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
      reloadEvent();
    } catch (err) {
      showError(err);
    } finally {
      setBusy('');
    }
  };

  const saveScoring = () => {
    for (const r of scoring.tieBreakRules) {
      if (r.type === 'criterion' && !r.criterion) return showMessage('Incomplete tie-break rule', 'Choose the criterion for the designated-criterion rule.');
      if (r.type === 'judge' && !r.judge) return showMessage('Incomplete tie-break rule', 'Choose the judge for the specified-judge rule.');
    }
    return run(
      'scoring',
      () =>
        api.patch(`/categories/${categoryId}`, {
          scoringMethod: scoring.scoringMethod,
          customStrategy: scoring.scoringMethod === 'custom' ? scoring.customStrategy : null,
          decimalPlaces: scoring.decimalPlaces,
          tieBreakRules: scoring.tieBreakRules.map((r) => ({ type: r.type, criterion: r.criterion || undefined, judge: r.judge || undefined })),
        }),
      'Scoring configuration saved'
    );
  };

  const saveCriterion = () => {
    const e = validateCriterion(critModal);
    setCritErrors(e);
    if (Object.keys(e).length) return;
    const payload = {
      name: critModal.name.trim(),
      description: critModal.description?.trim() || undefined,
      weight: Number(critModal.weight),
      minScore: Number(critModal.minScore),
      maxScore: Number(critModal.maxScore),
      decimalPlaces: Number(critModal.decimalPlaces),
      isActive: critModal.isActive,
    };
    return run(
      'criterion',
      async () => {
        if (critModal._id) await api.patch(`/criteria/${critModal._id}`, payload);
        else await api.post(`/categories/${categoryId}/criteria`, payload);
        setCritModal(null);
      },
      critModal._id ? 'Criterion updated' : 'Criterion added'
    );
  };

  const deleteCriterion = async (c) => {
    if (!(await confirmAction({ title: `Delete “${c.name}”?`, confirmText: 'Delete', danger: true }))) return;
    run(
      'criterion',
      async () => {
        const { data: r } = await api.delete(`/criteria/${c._id}`);
        if (r.disabled) toast.info(r.message);
      },
      'Criterion removed'
    );
  };

  const moveCriterion = (index, dir) => {
    const ids = data.criteria.map((c) => c._id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    run('order', () => api.put(`/categories/${categoryId}/criteria/reorder`, { ids }));
  };

  const lock = async () => {
    const { data: check } = await api.get(`/categories/${categoryId}/config-check`);
    if (!check.ok) {
      showError({ response: { data: { message: 'Fix these issues before opening scoring:', errors: check.errors } } }, 'Configuration incomplete');
      return;
    }
    const ok = await confirmAction({
      title: 'Lock configuration and open scoring?',
      text: `Judges will be able to score “${category.name}”. Criteria, weights, scoring method, tie-break rules, judges and contestants will be locked. ${check.warnings.length ? `Warnings: ${check.warnings.join(' ')}` : ''}`,
      confirmText: 'Lock & open scoring',
    });
    if (ok) run('lock', () => api.post(`/categories/${categoryId}/lock`), 'Scoring is now open');
  };

  const reopenConfig = async () => {
    const reason = await promptReason({
      title: 'Formally reopen configuration?',
      text: 'All submitted score sheets in this category will be reopened and judges must re-submit. This action is recorded in the audit trail.',
      confirmText: 'Reopen configuration',
    });
    if (reason) run('reopen', () => api.post(`/categories/${categoryId}/reopen-config`, { reason }), 'Configuration reopened');
  };

  const toggleScoring = async (open) => {
    if (!open && !(await confirmAction({ title: 'Close scoring?', text: 'Judges will no longer be able to save or submit score sheets.', confirmText: 'Close scoring' }))) return;
    run('toggle', () => api.post(`/categories/${categoryId}/${open ? 'reopen-scoring' : 'close-scoring'}`), open ? 'Scoring reopened' : 'Scoring closed');
  };

  const removeCategory = async () => {
    if (!(await confirmAction({ title: `Delete “${category.name}”?`, text: 'Criteria and draft score sheets will be removed. Categories with submitted scores cannot be deleted.', confirmText: 'Delete category', danger: true }))) return;
    try {
      await api.delete(`/categories/${categoryId}`);
      toast.success('Category deleted');
      reloadEvent();
      navigate(`/app/events/${event._id}/categories`);
    } catch (err) {
      showError(err, 'Cannot delete category');
    }
  };

  const saveDetails = () => {
    const e = validateCategory(editForm);
    if (Object.keys(e).length) return showMessage('Check the form', e.name);
    return run(
      'details',
      async () => {
        await api.patch(`/categories/${categoryId}`, { name: editForm.name, description: editForm.description, instructions: editForm.instructions });
        setEditOpen(false);
      },
      'Category updated'
    );
  };

  if (!data || !scoring) return <PageSkeleton />;

  const contestantItems = eventContestants.filter((c) => c.status === 'active' || selContestants.includes(c._id)).map((c) => ({ ...c, id: c._id }));
  const judgeItems = eventJudges.map((a) => ({ id: String(a.user._id), user: a.user, order: a.order }));

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/app/events/${event._id}/categories`} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ChevronLeft className="size-4" /> All categories
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink-900">{category.name}</h2>
              <StatusBadge kind="category" status={category.status} />
              {locked ? (
                <Badge tone="brand">
                  <Lock className="size-3" /> Locked · v{category.configVersion}
                </Badge>
              ) : (
                <Badge>
                  <LockOpen className="size-3" /> Editable
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-500">{data.methodLabel}{category.description ? ` · ${category.description}` : ''}</p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={Pencil}
                onClick={() => {
                  setEditForm({ name: category.name, description: category.description || '', instructions: category.instructions || '', scoringMethod: category.scoringMethod });
                  setEditOpen(true);
                }}
              >
                Edit details
              </Button>
              {!locked && (
                <Button size="sm" icon={Play} onClick={lock} loading={busy === 'lock'}>
                  Lock & open scoring
                </Button>
              )}
              {locked && category.status === 'scoring' && (
                <Button variant="secondary" size="sm" icon={Pause} onClick={() => toggleScoring(false)} loading={busy === 'toggle'}>
                  Close scoring
                </Button>
              )}
              {locked && category.status === 'closed' && (
                <Button variant="secondary" size="sm" icon={Play} onClick={() => toggleScoring(true)} loading={busy === 'toggle'}>
                  Reopen scoring
                </Button>
              )}
              {locked && (
                <Button variant="secondary" size="sm" icon={ShieldAlert} onClick={reopenConfig} loading={busy === 'reopen'}>
                  Reopen configuration
                </Button>
              )}
              {!locked && <IconButton icon={Trash2} label="Delete category" onClick={removeCategory} className="text-red-500 hover:bg-red-50 hover:text-red-600" />}
            </div>
          )}
        </div>
      </div>

      {locked && (
        <Alert tone="blue" icon={Lock} title="Configuration locked while scoring is in progress">
          Locked by {data.versions[0]?.lockedBy?.name || 'an administrator'} on {formatDateTime(category.lockedAt)}. Historical configurations are preserved as versioned snapshots.
        </Alert>
      )}
      {!locked && data.configCheck && (
        <Alert tone={data.configCheck.ok ? 'green' : 'amber'} icon={data.configCheck.ok ? CheckCircle2 : TriangleAlert} title={data.configCheck.ok ? 'Configuration is valid and ready to open for scoring' : 'Configuration incomplete'}>
          {[...data.configCheck.errors, ...data.configCheck.warnings].length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {data.configCheck.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
              {data.configCheck.warnings.map((w) => (
                <li key={w} className="opacity-75">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {/* ---------------- Criteria ---------------- */}
      <Card>
        <CardHeader
          title="Judging criteria"
          description={usesCriteria ? (needsWeights ? 'Weights must total exactly 100%.' : 'Weights are informational for this method.') : 'Rank-based scoring: criteria are shown to judges as guidance only.'}
          actions={
            <>
              <Badge tone={!needsWeights || Math.abs(totalWeight - 100) < 0.0001 ? 'green' : 'amber'}>Total {totalWeight}%</Badge>
              {configEditable && otherCategories.length > 0 && (
                <Button variant="secondary" size="sm" icon={Copy} onClick={() => setCopyOpen(true)}>
                  Copy from…
                </Button>
              )}
              {configEditable && (
                <Button
                  size="sm"
                  icon={Plus}
                  onClick={() => {
                    setCritErrors({});
                    setCritModal({ ...emptyCriterion, weight: needsWeights ? Math.max(0, +(100 - totalWeight).toFixed(4)) : 0 });
                  }}
                >
                  Add criterion
                </Button>
              )}
            </>
          }
        />
        {data.criteria.length === 0 ? (
          <EmptyState title="No criteria yet" description="Example: Creativity 30%, Performance 40%, Overall Impact 30%." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Criterion</th>
                  <th className="text-right">Weight</th>
                  <th className="text-center">Score range</th>
                  <th className="text-center">Decimals</th>
                  <th>Status</th>
                  {configEditable && <th className="w-36" />}
                </tr>
              </thead>
              <tbody>
                {data.criteria.map((c, i) => (
                  <tr key={c._id} className={cx(!c.isActive && 'opacity-50')}>
                    <td className="text-ink-400 tabular-nums">{i + 1}</td>
                    <td>
                      <p className="font-medium text-ink-800">{c.name}</p>
                      {c.description && <p className="text-xs text-ink-500">{c.description}</p>}
                    </td>
                    <td className="text-right font-semibold tabular-nums">{c.weight}%</td>
                    <td className="text-center tabular-nums">
                      {c.minScore} – {c.maxScore}
                    </td>
                    <td className="text-center tabular-nums">{c.decimalPlaces}</td>
                    <td>{c.isActive ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}</td>
                    {configEditable && (
                      <td>
                        <div className="flex justify-end">
                          <IconButton icon={ArrowUp} label="Move up" disabled={i === 0 || !!busy} onClick={() => moveCriterion(i, -1)} />
                          <IconButton icon={ArrowDown} label="Move down" disabled={i === data.criteria.length - 1 || !!busy} onClick={() => moveCriterion(i, 1)} />
                          <IconButton
                            icon={Pencil}
                            label="Edit"
                            onClick={() => {
                              setCritErrors({});
                              setCritModal({ ...c, description: c.description || '' });
                            }}
                          />
                          <IconButton icon={Trash2} label="Delete" onClick={() => deleteCriterion(c)} className="hover:text-red-600" />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ---------------- Scoring method & ties ---------------- */}
        <Card>
          <CardHeader
            title="Scoring method & tie-breaking"
            description="Must be set before scoring starts."
            actions={
              configEditable && dirtyScoring && (
                <Button size="sm" icon={Save} onClick={saveScoring} loading={busy === 'scoring'}>
                  Save
                </Button>
              )
            }
          />
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Computation method" hint={SCORING_METHODS.find((m) => m.value === scoring.scoringMethod)?.help}>
                <Select disabled={!configEditable} value={scoring.scoringMethod} onChange={(e) => setScoring({ ...scoring, scoringMethod: e.target.value })}>
                  {SCORING_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Result decimal places" hint="Rankings compare scores at this precision.">
                <Select disabled={!configEditable} value={scoring.decimalPlaces} onChange={(e) => setScoring({ ...scoring, decimalPlaces: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              {scoring.scoringMethod === 'custom' && (
                <Field label="Custom strategy" className="sm:col-span-2">
                  <Select disabled={!configEditable} value={scoring.customStrategy} onChange={(e) => setScoring({ ...scoring, customStrategy: e.target.value })}>
                    {CUSTOM_STRATEGIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink-700">Tie-breaking rules (applied in order)</p>
              <TieRulesEditor rules={scoring.tieBreakRules} onChange={(r) => setScoring({ ...scoring, tieBreakRules: r })} criteria={data.criteria} judges={data.judges} disabled={!configEditable} usesCriteria={usesCriteria} />
              <p className="mt-2 text-xs text-ink-500">Ties are never resolved by arbitrary order. Contestants still tied after the last rule share the rank (1, 2, 2, 4).</p>
            </div>
          </div>
        </Card>

        {/* ---------------- Overall + versions ---------------- */}
        <div className="space-y-6">
          {event.overall?.enabled && (
            <Card>
              <CardHeader
                title={`Counts toward “${event.overall.title}”`}
                actions={
                  editable &&
                  (overall.includeInOverall !== category.includeInOverall || Number(overall.overallWeight) !== category.overallWeight) && (
                    <Button size="sm" icon={Save} loading={busy === 'overall'} onClick={() => run('overall', () => api.patch(`/categories/${categoryId}`, { includeInOverall: overall.includeInOverall, overallWeight: Number(overall.overallWeight) || 0 }), 'Overall settings saved')}>
                      Save
                    </Button>
                  )
                }
              />
              <div className="flex flex-wrap items-end gap-6 p-5">
                <Toggle disabled={!editable} checked={overall.includeInOverall} onChange={(v) => setOverall({ ...overall, includeInOverall: v })} label="Include in overall tally" />
                {overall.includeInOverall && event.overall.method === 'weighted' && (
                  <Field label="Category weight (%)" className="w-40">
                    <Input disabled={!editable} type="number" min="0" max="100" step="0.01" value={overall.overallWeight} onChange={(e) => setOverall({ ...overall, overallWeight: e.target.value })} />
                  </Field>
                )}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Awardees"
              description="How many places are announced as winners. Can be changed anytime; it does not affect the ranking."
              actions={
                editable &&
                awardees !== (category.awardees ?? 3) && (
                  <Button size="sm" icon={Save} loading={busy === 'awardees'} onClick={() => run('awardees', () => api.patch(`/categories/${categoryId}`, { awardees }), 'Awardees saved')}>
                    Save
                  </Button>
                )
              }
            />
            <div className="p-5">
              <Field label="Number of awardees" hint={`Top ${awardees}: ranks 1–${awardees} are highlighted in the tally, reports and public results.`} className="max-w-xs">
                <Select disabled={!editable} value={awardees} onChange={(e) => setAwardees(Number(e.target.value))}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? 'Top 1 (winner only)' : `Top ${n}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Configuration history" description="Snapshot written each time scoring opens." />
            {data.versions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-500">Not yet locked.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.versions.map((v) => (
                  <li key={v._id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink-800">Version {v.version}</span>
                      <span className="text-xs text-ink-500">{formatDateTime(v.lockedAt)}</span>
                    </div>
                    <p className="text-xs text-ink-500">
                      Locked by {v.lockedBy?.name || '—'}
                      {v.reopenedAt && ` · Reopened ${formatDateTime(v.reopenedAt)}: ${v.reopenReason}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Contestants in this category"
            description={`${selContestants.length} selected`}
            actions={
              configEditable &&
              dirtyContestants && (
                <Button size="sm" icon={Save} loading={busy === 'contestants'} onClick={() => run('contestants', () => api.put(`/categories/${categoryId}/contestants`, { contestantIds: selContestants }), 'Contestants updated')}>
                  Save
                </Button>
              )
            }
          />
          <Picker
            items={contestantItems}
            selected={selContestants}
            onChange={setSelContestants}
            disabled={!configEditable}
            empty="No contestants in this event yet. Add them on the Contestants tab."
            render={(c) => (
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={c.name} src={c.photo} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-800">
                    #{c.number} {c.name}
                  </span>
                  <span className="block truncate text-xs text-ink-500">{[c.isTeam && 'Team', c.representing, c.status !== 'active' && c.status].filter(Boolean).join(' · ')}</span>
                </span>
              </span>
            )}
          />
        </Card>
        <Card>
          <CardHeader
            title="Judging panel"
            description={`${selJudges.length} judge${selJudges.length === 1 ? '' : 's'} assigned`}
            actions={
              configEditable &&
              dirtyJudges && (
                <Button size="sm" icon={Save} loading={busy === 'judges'} onClick={() => run('judges', () => api.put(`/categories/${categoryId}/judges`, { judgeIds: selJudges }), 'Judges updated')}>
                  Save
                </Button>
              )
            }
          />
          <Picker
            items={judgeItems}
            selected={selJudges}
            onChange={setSelJudges}
            disabled={!configEditable}
            empty="No judges added to this event yet. Add them on the Judges & Staff tab."
            render={(j) => (
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={j.user.name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-800">{j.user.name}</span>
                  <span className="block truncate text-xs text-ink-500">
                    Judge {j.order}
                    {j.user.title && ` · ${j.user.title}`}
                  </span>
                </span>
              </span>
            )}
          />
        </Card>
      </div>

      {/* ---------------- Modals ---------------- */}
      <Modal
        open={!!critModal}
        onClose={() => setCritModal(null)}
        title={critModal?._id ? 'Edit criterion' : 'Add criterion'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCritModal(null)}>
              Cancel
            </Button>
            <Button onClick={saveCriterion} loading={busy === 'criterion'}>
              Save criterion
            </Button>
          </>
        }
      >
        {critModal && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={critErrors.name} className="sm:col-span-2">
              <Input value={critModal.name} onChange={(e) => setCritModal({ ...critModal, name: e.target.value })} invalid={!!critErrors.name} placeholder="e.g. Stage Presence" />
            </Field>
            <Field label="Description / scoring guide" className="sm:col-span-2">
              <Textarea rows={2} value={critModal.description} onChange={(e) => setCritModal({ ...critModal, description: e.target.value })} />
            </Field>
            <Field label="Weight (%)" required error={critErrors.weight} hint={needsWeights ? `Remaining: ${+(100 - totalWeight + (critModal._id && critModal.isActive ? Number(data.criteria.find((c) => c._id === critModal._id)?.weight || 0) : 0)).toFixed(4)}%` : undefined}>
              <Input type="number" min="0" max="100" step="0.01" value={critModal.weight} onChange={(e) => setCritModal({ ...critModal, weight: e.target.value })} invalid={!!critErrors.weight} />
            </Field>
            <Field label="Input decimal places">
              <Select value={critModal.decimalPlaces} onChange={(e) => setCritModal({ ...critModal, decimalPlaces: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Minimum score" required error={critErrors.minScore}>
              <Input type="number" min="0" step="any" value={critModal.minScore} onChange={(e) => setCritModal({ ...critModal, minScore: e.target.value })} invalid={!!critErrors.minScore} />
            </Field>
            <Field label="Maximum score" required error={critErrors.maxScore}>
              <Input type="number" min="0" step="any" value={critModal.maxScore} onChange={(e) => setCritModal({ ...critModal, maxScore: e.target.value })} invalid={!!critErrors.maxScore} />
            </Field>
            <div className="sm:col-span-2">
              <Toggle checked={critModal.isActive} onChange={(v) => setCritModal({ ...critModal, isActive: v })} label="Active" description="Disabled criteria are not scored and do not count toward the 100% total." />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Copy criteria from another category"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCopyOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!copyFrom}
              loading={busy === 'copy'}
              onClick={() =>
                run(
                  'copy',
                  async () => {
                    await api.post(`/categories/${categoryId}/copy-criteria`, { fromCategory: copyFrom });
                    setCopyOpen(false);
                  },
                  'Criteria copied'
                )
              }
            >
              Copy criteria
            </Button>
          </>
        }
      >
        <Field label="Source category" hint="Active criteria are appended to this category.">
          <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Choose…</option>
            {otherCategories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} ({c.stats.criteria} criteria)
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit category details"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveDetails} loading={busy === 'details'}>
              Save
            </Button>
          </>
        }
      >
        {editForm && <CategoryForm value={editForm} onChange={setEditForm} showScoring={false} />}
      </Modal>
    </div>
  );
}
