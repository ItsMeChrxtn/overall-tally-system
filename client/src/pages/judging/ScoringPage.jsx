import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Info, Lock, RotateCcw, Save, Send, Users } from 'lucide-react';
import api, { apiErrorMessage } from '../../api/client';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, Input, PageSkeleton, Select, cx } from '../../components/ui';
import { decimalsOf, formatDateTime, num } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const STATUS = {
  submitted: { label: 'Submitted', tone: 'green', icon: CheckCircle2 },
  draft: { label: 'Draft', tone: 'amber', icon: CircleDashed },
  reopened: { label: 'Reopened', tone: 'red', icon: RotateCcw },
  none: { label: 'Not started', tone: 'gray', icon: CircleDashed },
};

function validateValue(raw, c) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const v = Number(raw);
  if (Number.isNaN(v)) return 'Not a number';
  if (v < c.minScore || v > c.maxScore) return `${c.minScore}–${c.maxScore}`;
  if (decimalsOf(raw) > (c.decimalPlaces ?? 2)) return `Max ${c.decimalPlaces} decimals`;
  return null;
}

/** Client-side PREVIEW only. Official totals are computed by the server. */
function preview(criteria, values) {
  const filled = criteria.filter((c) => values[c.criterionId] !== '' && values[c.criterionId] !== undefined && !validateValue(values[c.criterionId], c));
  const total = filled.reduce((a, c) => a + Number(values[c.criterionId]), 0);
  const weighted = filled.reduce((a, c) => a + (Number(values[c.criterionId]) / c.maxScore) * c.weight, 0);
  return { total, weighted, complete: filled.length === criteria.length };
}

// ------------------------------------------------------------------ criteria-based sheet
function CriteriaScoring({ data, reload }) {
  const { category, criteria, contestants } = data;
  const [sheets, setSheets] = useState(() => Object.fromEntries(data.sheets.map((s) => [String(s.contestant), s])));
  const [selected, setSelected] = useState(() => {
    const firstPending = contestants.find((c) => sheets[String(c._id)]?.status !== 'submitted');
    return String((firstPending || contestants[0])?._id || '');
  });
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const inputs = useRef([]);

  useEffect(() => setSheets(Object.fromEntries(data.sheets.map((s) => [String(s.contestant), s]))), [data.sheets]);

  const sheet = sheets[selected];
  const locked = sheet?.status === 'submitted' || !category.scoringOpen;
  const contestant = contestants.find((c) => String(c._id) === selected);

  useEffect(() => {
    const s = sheets[selected];
    setValues(Object.fromEntries(criteria.map((c) => [c.criterionId, s?.scores?.find((x) => String(x.criterion) === String(c.criterionId))?.value ?? ''])));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sheets[selected]?.savedAt, sheets[selected]?.status]);

  const errors = useMemo(() => Object.fromEntries(criteria.map((c) => [c.criterionId, validateValue(values[c.criterionId], c)])), [criteria, values]);
  const hasErrors = Object.values(errors).some(Boolean);
  const pv = preview(criteria, values);
  const payload = () => ({ scores: criteria.filter((c) => values[c.criterionId] !== '').map((c) => ({ criterion: c.criterionId, value: Number(values[c.criterionId]) })) });

  const saveDraft = async (silent = false) => {
    if (hasErrors) {
      if (!silent) showError({ response: { data: { message: 'Fix the highlighted scores before saving.' } } }, 'Invalid scores');
      return false;
    }
    setBusy('save');
    try {
      const { data: r } = await api.put(`/judging/categories/${category._id}/sheets/${selected}`, payload());
      setSheets((s) => ({ ...s, [selected]: r.sheet }));
      setDirty(false);
      if (!silent) toast.success('Draft saved');
      return true;
    } catch (err) {
      if (!silent) showError(err, 'Could not save');
      return false;
    } finally {
      setBusy('');
    }
  };

  const select = async (id) => {
    if (id === selected) return;
    if (dirty && !locked) await saveDraft(true);
    setSelected(id);
  };

  const submit = async () => {
    if (hasErrors || !pv.complete) return showError({ response: { data: { message: 'Score every criterion within its allowed range before submitting.' } } }, 'Incomplete score sheet');
    const rows = criteria.map((c) => `<tr><td style="text-align:left;padding:4px 8px">${c.name}</td><td style="text-align:right;padding:4px 8px;font-weight:600">${values[c.criterionId]}</td></tr>`).join('');
    const res = await Swal.fire({
      title: `Submit scores for #${contestant.number} ${contestant.name}?`,
      html: `<table style="width:100%;font-size:13px;margin-top:6px">${rows}</table><p style="margin-top:10px;font-size:12px;color:#64748b">Preview total ${num(pv.total)} · weighted ${num(pv.weighted)}. Once submitted, this sheet is locked and can only be changed through an authorized correction.</p>`,
      showCancelButton: true,
      confirmButtonText: 'Submit & lock',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    setBusy('submit');
    try {
      const { data: r } = await api.post(`/judging/categories/${category._id}/sheets/${selected}/submit`, payload());
      setSheets((s) => ({ ...s, [selected]: r.sheet }));
      setDirty(false);
      toast.success('Score sheet submitted');
      const next = contestants.find((c) => String(c._id) !== selected && sheets[String(c._id)]?.status !== 'submitted');
      if (next) setSelected(String(next._id));
    } catch (err) {
      showError(err, 'Submission failed');
    } finally {
      setBusy('');
    }
  };

  const submitAll = async () => {
    const pending = contestants.filter((c) => sheets[String(c._id)]?.status !== 'submitted');
    if (dirty && !(await saveDraft(true))) return;
    if (!(await confirmAction({ title: `Submit all ${pending.length} remaining sheets?`, text: 'Every remaining sheet must be fully scored. All will be locked after submission.', confirmText: 'Submit all' }))) return;
    setBusy('all');
    try {
      await api.post(`/judging/categories/${category._id}/submit-all`, {});
      toast.success('All score sheets submitted');
      reload();
    } catch (err) {
      showError(err, 'Could not submit all');
    } finally {
      setBusy('');
    }
  };

  const onKey = (e, i) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = inputs.current[i + 1];
      if (next) next.focus();
      else if (!locked) saveDraft();
    }
  };

  const submittedCount = contestants.filter((c) => sheets[String(c._id)]?.status === 'submitted').length;
  const idx = contestants.findIndex((c) => String(c._id) === selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader title="Contestants" description={`${submittedCount} of ${contestants.length} submitted`} />
        <ul className="max-h-[60vh] divide-y divide-slate-50 overflow-y-auto">
          {contestants.map((c) => {
            const st = STATUS[sheets[String(c._id)]?.status || 'none'];
            return (
              <li key={c._id}>
                <button type="button" onClick={() => select(String(c._id))} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors', String(c._id) === selected ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                  <span className="w-7 text-center text-sm font-semibold text-slate-500 tabular-nums">{c.number}</span>
                  <Avatar name={c.name} src={c.photo} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{c.name}</span>
                    <span className="block truncate text-xs text-slate-500">{c.representing || (c.isTeam ? 'Team' : '')}</span>
                  </span>
                  <st.icon className={cx('size-4 shrink-0', { green: 'text-emerald-500', amber: 'text-amber-500', red: 'text-red-500', gray: 'text-slate-300' }[st.tone])} />
                </button>
              </li>
            );
          })}
        </ul>
        {category.scoringOpen && submittedCount < contestants.length && (
          <div className="border-t border-slate-100 p-3">
            <Button variant="secondary" size="sm" icon={CheckCheck} className="w-full" onClick={submitAll} loading={busy === 'all'}>
              Submit all remaining
            </Button>
          </div>
        )}
      </Card>

      {contestant ? (
        <Card>
          <div className="flex flex-wrap items-start gap-4 border-b border-slate-100 p-5">
            <Avatar name={contestant.name} src={contestant.photo} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  #{contestant.number} {contestant.name}
                </h2>
                <Badge tone={STATUS[sheet?.status || 'none'].tone} dot>
                  {STATUS[sheet?.status || 'none'].label}
                </Badge>
              </div>
              {contestant.representing && <p className="text-sm text-slate-500">{contestant.representing}</p>}
              {contestant.isTeam && contestant.members?.length > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                  <Users className="mt-0.5 size-3.5 shrink-0" /> {contestant.members.join(', ')}
                </p>
              )}
              {contestant.description && <p className="mt-2 text-sm text-slate-600">{contestant.description}</p>}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" icon={ChevronLeft} disabled={idx <= 0} onClick={() => select(String(contestants[idx - 1]._id))}>
                Prev
              </Button>
              <Button variant="ghost" size="sm" disabled={idx >= contestants.length - 1} onClick={() => select(String(contestants[idx + 1]._id))}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {sheet?.status === 'reopened' && (
            <div className="px-5 pt-5">
              <Alert tone="red" icon={RotateCcw} title="Reopened for correction">
                {sheet.reopenReason}
              </Alert>
            </div>
          )}
          {sheet?.status === 'submitted' && (
            <div className="px-5 pt-5">
              <Alert tone="green" icon={Lock} title="Submitted and locked">
                Submitted {formatDateTime(sheet.submittedAt)}. Contact the event administrator if a correction is needed.
              </Alert>
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {criteria.map((c, i) => {
              const err = errors[c.criterionId];
              return (
                <div key={c.criterionId} className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_160px]">
                  <div>
                    <p className="font-medium text-slate-800">
                      {c.name} <span className="ml-1 text-xs font-normal text-slate-500">{c.weight}%</span>
                    </p>
                    {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                  </div>
                  <div>
                    <Input
                      ref={(el) => (inputs.current[i] = el)}
                      type="number"
                      inputMode="decimal"
                      min={c.minScore}
                      max={c.maxScore}
                      step={c.decimalPlaces ? 1 / 10 ** c.decimalPlaces : 1}
                      disabled={locked}
                      value={values[c.criterionId] ?? ''}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [c.criterionId]: e.target.value }));
                        setDirty(true);
                      }}
                      onKeyDown={(e) => onKey(e, i)}
                      invalid={!!err}
                      placeholder={`${c.minScore} – ${c.maxScore}`}
                      className="h-11 text-right text-lg font-semibold tabular-nums"
                    />
                    <p className={cx('mt-1 text-right text-[11px]', err ? 'text-red-600' : 'text-slate-400')}>{err || `Range ${c.minScore}–${c.maxScore}${c.decimalPlaces ? `, ${c.decimalPlaces} dp` : ''}`}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
            <div className="text-sm">
              <span className="text-slate-500">Preview: </span>
              <span className="font-semibold tabular-nums">Total {num(pv.total)}</span>
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-semibold tabular-nums">Weighted {num(pv.weighted)}</span>
              <span className="block text-[11px] text-slate-400">Official scores are computed by the server.</span>
            </div>
            {!locked && (
              <div className="flex gap-2">
                <Button variant="secondary" icon={Save} onClick={() => saveDraft()} loading={busy === 'save'} disabled={!dirty && !!sheet}>
                  Save draft
                </Button>
                <Button icon={Send} onClick={submit} loading={busy === 'submit'} disabled={!pv.complete || hasErrors}>
                  Review & submit
                </Button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState title="No contestants in this category" />
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rank-based sheet
function RankScoring({ data, reload }) {
  const { category, contestants, sheets } = data;
  const n = contestants.length;
  const byId = Object.fromEntries(sheets.map((s) => [String(s.contestant), s]));
  const allSubmitted = contestants.every((c) => byId[String(c._id)]?.status === 'submitted');
  const locked = allSubmitted || !category.scoringOpen;
  const [ranks, setRanks] = useState(() => Object.fromEntries(contestants.map((c) => [String(c._id), byId[String(c._id)]?.rank ?? ''])));
  const [busy, setBusy] = useState('');

  const counts = Object.values(ranks).filter(Boolean).reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {});
  const duplicates = Object.keys(counts).filter((r) => counts[r] > 1).map(Number);
  const complete = contestants.every((c) => ranks[String(c._id)]) && !duplicates.length;

  const saveAll = async (silent) => {
    setBusy('save');
    try {
      for (const c of contestants) {
        const r = ranks[String(c._id)];
        await api.put(`/judging/categories/${category._id}/sheets/${c._id}`, { rank: r ? Number(r) : null });
      }
      if (!silent) toast.success('Draft rankings saved');
      return true;
    } catch (err) {
      showError(err, 'Could not save');
      return false;
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    if (!complete) return showError({ response: { data: { message: `Give every contestant a unique rank from 1 to ${n}.` } } }, 'Incomplete ranking');
    if (!(await confirmAction({ title: 'Submit your final ranking?', text: 'Your ranking will be locked and can only be changed through an authorized correction.', confirmText: 'Submit ranking' }))) return;
    setBusy('submit');
    try {
      await api.post(`/judging/categories/${category._id}/submit-all`, { sheets: contestants.map((c) => ({ contestant: c._id, rank: Number(ranks[String(c._id)]) })) });
      toast.success('Ranking submitted');
      reload();
    } catch (err) {
      showError(err, 'Submission failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <CardHeader title="Rank the contestants" description={`Assign each contestant a unique rank from 1 (best) to ${n}.`} actions={allSubmitted && <Badge tone="green">Submitted</Badge>} />
      {sheets.some((s) => s.status === 'reopened') && (
        <div className="px-5 pt-4">
          <Alert tone="red" icon={RotateCcw} title="Ranking reopened for correction">
            {sheets.find((s) => s.status === 'reopened')?.reopenReason}
          </Alert>
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {contestants.map((c) => {
          const r = ranks[String(c._id)];
          const dup = r && duplicates.includes(Number(r));
          return (
            <li key={c._id} className="flex items-center gap-4 px-5 py-3">
              <span className="w-8 text-center font-semibold text-slate-500 tabular-nums">#{c.number}</span>
              <Avatar name={c.name} src={c.photo} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{c.name}</p>
                {c.representing && <p className="text-xs text-slate-500">{c.representing}</p>}
              </div>
              <div className="w-32">
                <Select disabled={locked} value={r} onChange={(e) => setRanks({ ...ranks, [String(c._id)]: e.target.value })} className={cx(dup && 'border-red-400')}>
                  <option value="">Rank…</option>
                  {Array.from({ length: n }, (_, i) => i + 1).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
                {dup && <p className="mt-0.5 text-[11px] text-red-600">Rank used twice</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {!locked && (
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4">
          <Button variant="secondary" icon={Save} onClick={() => saveAll(false)} loading={busy === 'save'}>
            Save draft
          </Button>
          <Button icon={Send} onClick={submit} loading={busy === 'submit'} disabled={!complete}>
            Submit ranking
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function ScoringPage() {
  const { categoryId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    return api
      .get(`/judging/categories/${categoryId}`)
      .then(({ data: d }) => setData(d))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [categoryId]);
  useEffect(() => {
    load();
  }, [load]);

  useEventSocket(data?.event?._id, {
    'category:updated': (p) => p.categoryId === categoryId && load(),
    'sheet:reopened': (p) => p.categoryId === categoryId && load(),
  });

  if (error) return <EmptyState title="Unable to open this category" description={error} action={<Link to="/app/judging" className="text-sm font-medium text-brand-600">Back to my assignments</Link>} />;
  if (!data) return <PageSkeleton />;
  const { event, category } = data;

  return (
    <div>
      <Link to="/app/judging" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ChevronLeft className="size-4" /> My assignments
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-brand-600 uppercase">{event.name}</p>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{category.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{category.methodLabel}</p>
        </div>
        {category.scoringOpen ? <Badge tone="violet" dot>Scoring open</Badge> : <Badge tone="gray"><Lock className="size-3" /> {category.configLocked ? 'Scoring closed' : 'Not open yet'}</Badge>}
      </div>
      {category.instructions && (
        <Alert tone="blue" icon={Info} title="Instructions" className="mb-5">
          {category.instructions}
        </Alert>
      )}
      {!category.configLocked ? (
        <Card>
          <EmptyState icon={Lock} title="Scoring has not opened yet" description="The organizers will open this category when the competition begins. This page updates automatically." />
        </Card>
      ) : category.usesCriteria ? (
        <CriteriaScoring data={data} reload={load} />
      ) : (
        <RankScoring key={data.sheets.map((s) => s.status).join()} data={data} reload={load} />
      )}
    </div>
  );
}
