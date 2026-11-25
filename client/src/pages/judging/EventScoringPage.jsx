import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import { CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Lock, RotateCcw, Save, Send, Users } from 'lucide-react';
import api, { apiErrorMessage } from '../../api/client';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, Input, PageSkeleton, Select, cx } from '../../components/ui';
import { decimalsOf, formatDateTime, num } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const STATUS = {
  submitted: { label: 'Submitted', tone: 'green', icon: CheckCircle2, color: 'text-brand-600' },
  partial: { label: 'Partly submitted', tone: 'amber', icon: CircleDashed, color: 'text-gold-500' },
  draft: { label: 'Draft', tone: 'amber', icon: CircleDashed, color: 'text-gold-500' },
  reopened: { label: 'Reopened', tone: 'red', icon: RotateCcw, color: 'text-red-600' },
  none: { label: 'Not started', tone: 'gray', icon: CircleDashed, color: 'text-ink-300' },
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const key = (catId, contestantId) => `${catId}:${contestantId}`;

function validateValue(raw, c) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const v = Number(raw);
  if (Number.isNaN(v)) return 'Not a number';
  if (v < c.minScore || v > c.maxScore) return `${c.minScore}–${c.maxScore}`;
  if (decimalsOf(raw) > (c.decimalPlaces ?? 2)) return `Max ${c.decimalPlaces} decimals`;
  return null;
}

/** Client-side PREVIEW only. Official totals are computed by the server. */
function preview(criteria, values = {}) {
  const filled = criteria.filter((c) => values[c.criterionId] !== '' && values[c.criterionId] !== undefined && !validateValue(values[c.criterionId], c));
  const total = filled.reduce((a, c) => a + Number(values[c.criterionId]), 0);
  const weighted = filled.reduce((a, c) => a + (Number(values[c.criterionId]) / c.maxScore) * c.weight, 0);
  return { total, weighted, complete: filled.length === criteria.length };
}

const valuesFromSheet = (criteria, sheet) => Object.fromEntries(criteria.map((c) => [c.criterionId, sheet?.scores?.find((x) => String(x.criterion) === String(c.criterionId))?.value ?? '']));
const sheetIsComplete = (criteria, sheet) => !!sheet && criteria.every((c) => sheet.scores?.some((x) => String(x.criterion) === String(c.criterionId)));

// ------------------------------------------------------------------ every criteria-based category, one sheet per contestant
function CombinedCriteriaScoring({ cats, reload, focusCategory }) {
  const [sheets, setSheets] = useState({});
  useEffect(() => {
    const next = {};
    cats.forEach((d) => d.sheets.forEach((s) => (next[key(d.category._id, s.contestant)] = s)));
    setSheets(next);
  }, [cats]);

  // Contestants across all categories (a contestant may only be entered in some of them)
  const contestants = useMemo(() => {
    const map = new Map();
    cats.forEach((d) => d.contestants.forEach((c) => !map.has(String(c._id)) && map.set(String(c._id), c)));
    return [...map.values()].sort((a, b) => a.number - b.number);
  }, [cats]);

  const sectionsFor = useCallback((contestantId) => cats.filter((d) => d.contestants.some((c) => String(c._id) === String(contestantId))), [cats]);

  const statusOf = useCallback(
    (contestantId) => {
      const list = sectionsFor(contestantId).map((d) => sheets[key(d.category._id, contestantId)]?.status);
      if (!list.length) return 'none';
      if (list.some((s) => s === 'reopened')) return 'reopened';
      if (list.every((s) => s === 'submitted')) return 'submitted';
      if (list.some((s) => s === 'submitted')) return 'partial';
      if (list.some((s) => s === 'draft')) return 'draft';
      return 'none';
    },
    [sectionsFor, sheets]
  );

  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (selected && contestants.some((c) => String(c._id) === selected)) return;
    const firstPending = contestants.find((c) => statusOf(c._id) !== 'submitted');
    setSelected(String((firstPending || contestants[0])?._id || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestants]);

  const sections = useMemo(() => sectionsFor(selected), [sectionsFor, selected]);
  const contestant = contestants.find((c) => String(c._id) === selected);

  // Values being edited for the selected contestant, per category
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState(() => new Set());
  const sheetStamp = sections.map((d) => `${sheets[key(d.category._id, selected)]?.savedAt}|${sheets[key(d.category._id, selected)]?.status}`).join();
  useEffect(() => {
    setValues(Object.fromEntries(sections.map((d) => [d.category._id, valuesFromSheet(d.criteria, sheets[key(d.category._id, selected)])])));
    setDirty(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sheetStamp]);

  const isLocked = (d) => sheets[key(d.category._id, selected)]?.status === 'submitted' || !d.category.scoringOpen;
  const editable = sections.filter((d) => !isLocked(d));
  const errorsFor = (d) => Object.fromEntries(d.criteria.map((c) => [c.criterionId, validateValue(values[d.category._id]?.[c.criterionId], c)]));
  const hasErrors = editable.some((d) => Object.values(errorsFor(d)).some(Boolean));
  const allComplete = editable.length > 0 && editable.every((d) => preview(d.criteria, values[d.category._id]).complete);
  const payload = (d) => ({ scores: d.criteria.filter((c) => (values[d.category._id]?.[c.criterionId] ?? '') !== '').map((c) => ({ criterion: c.criterionId, value: Number(values[d.category._id][c.criterionId]) })) });

  const [busy, setBusy] = useState('');
  const inputs = useRef([]);

  const saveDraft = async (silent = false) => {
    if (hasErrors) {
      if (!silent) showError({ response: { data: { message: 'Fix the highlighted scores before saving.' } } }, 'Invalid scores');
      return false;
    }
    const toSave = editable.filter((d) => dirty.has(d.category._id));
    if (!toSave.length) return true;
    setBusy('save');
    try {
      for (const d of toSave) {
        const { data: r } = await api.put(`/judging/categories/${d.category._id}/sheets/${selected}`, payload(d));
        setSheets((s) => ({ ...s, [key(d.category._id, selected)]: r.sheet }));
      }
      setDirty(new Set());
      if (!silent) toast.success('Draft saved');
      return true;
    } catch (err) {
      showError(err, 'Could not save');
      return false;
    } finally {
      setBusy('');
    }
  };

  const select = async (id) => {
    if (id === selected) return;
    if (dirty.size && !(await saveDraft(true))) return;
    setSelected(id);
  };

  const submit = async () => {
    if (hasErrors || !allComplete) return showError({ response: { data: { message: 'Score every criterion in every category before submitting.' } } }, 'Incomplete score sheet');
    const html = editable
      .map((d) => {
        const pv = preview(d.criteria, values[d.category._id]);
        const rows = d.criteria.map((c) => `<tr><td style="text-align:left;padding:3px 8px">${esc(c.name)}</td><td style="text-align:right;padding:3px 8px;font-weight:600">${esc(values[d.category._id][c.criterionId])}</td></tr>`).join('');
        return `<p style="text-align:left;margin:12px 8px 2px;font-weight:600;color:#0e1630">${esc(d.category.name)}<span style="float:right;font-weight:400;color:#8790a8">weighted ${num(pv.weighted)}</span></p><table style="width:100%;font-size:13px">${rows}</table>`;
      })
      .join('');
    const res = await Swal.fire({
      title: `Submit scores for #${contestant.number} ${esc(contestant.name)}?`,
      html: `${html}<p style="margin-top:12px;font-size:12px;color:#8790a8">${editable.length > 1 ? `All ${editable.length} categories will be submitted together. ` : ''}Submitted sheets are locked and can only be changed through an authorized correction.</p>`,
      showCancelButton: true,
      confirmButtonText: 'Submit & lock',
      reverseButtons: true,
    });
    if (!res.isConfirmed) return;
    // Keep what was typed as a draft first, so nothing is lost if one category fails to submit
    if (dirty.size && !(await saveDraft(true))) return;
    setBusy('submit');
    const failed = [];
    const next = { ...sheets };
    for (const d of editable) {
      try {
        const { data: r } = await api.post(`/judging/categories/${d.category._id}/sheets/${selected}/submit`, payload(d));
        next[key(d.category._id, selected)] = r.sheet;
      } catch (err) {
        failed.push(`${d.category.name}: ${apiErrorMessage(err)}`);
      }
    }
    setSheets(next);
    setDirty(new Set());
    setBusy('');
    if (failed.length) return showError({ response: { data: { message: failed.join('\n') } } }, 'Some categories were not submitted');
    toast.success('Score sheet submitted');
    const pendingNext = contestants.find((c) => String(c._id) !== selected && sectionsFor(c._id).some((d) => d.category.scoringOpen && next[key(d.category._id, c._id)]?.status !== 'submitted'));
    if (pendingNext) setSelected(String(pendingNext._id));
  };

  // Everything still pending, in every open category
  const pendingByCat = cats
    .filter((d) => d.category.scoringOpen)
    .map((d) => ({ d, pending: d.contestants.filter((c) => sheets[key(d.category._id, c._id)]?.status !== 'submitted') }))
    .filter((x) => x.pending.length);
  const pendingTotal = pendingByCat.reduce((a, x) => a + x.pending.length, 0);

  const submitAll = async () => {
    if (dirty.size && !(await saveDraft(true))) return;
    const incomplete = pendingByCat.flatMap(({ d, pending }) => pending.filter((c) => !sheetIsComplete(d.criteria, sheets[key(d.category._id, c._id)])).map((c) => `#${c.number} ${c.name} (${d.category.name})`));
    if (incomplete.length) {
      return showError({ response: { data: { message: `Finish these first: ${incomplete.slice(0, 6).join(', ')}${incomplete.length > 6 ? ` and ${incomplete.length - 6} more` : ''}.` } } }, 'Some sheets are incomplete');
    }
    if (!(await confirmAction({ title: `Submit all ${pendingTotal} remaining sheets?`, text: `Across ${pendingByCat.length} categor${pendingByCat.length === 1 ? 'y' : 'ies'}. All will be locked after submission.`, confirmText: 'Submit all' }))) return;
    setBusy('all');
    const failed = [];
    for (const { d } of pendingByCat) {
      try {
        await api.post(`/judging/categories/${d.category._id}/submit-all`, {});
      } catch (err) {
        failed.push(`${d.category.name}: ${apiErrorMessage(err)}`);
      }
    }
    setBusy('');
    if (failed.length) showError({ response: { data: { message: failed.join('\n') } } }, 'Some categories were not submitted');
    else toast.success('All score sheets submitted');
    reload();
  };

  const onKey = (e, i) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = inputs.current.slice(i + 1).find(Boolean);
    if (next) next.focus();
    else saveDraft();
  };

  // Bring the category from a notification link into view once
  const focused = useRef(false);
  useEffect(() => {
    if (!focusCategory || focused.current || !selected) return;
    focused.current = true;
    document.getElementById(`cat-${focusCategory}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusCategory, selected]);

  if (!contestants.length) {
    return (
      <Card>
        <EmptyState title="No contestants to score yet" />
      </Card>
    );
  }

  const submittedCount = contestants.filter((c) => statusOf(c._id) === 'submitted').length;
  const idx = contestants.findIndex((c) => String(c._id) === selected);
  const st = STATUS[statusOf(selected)];
  let inputIndex = -1;
  inputs.current = [];

  const cols = sections.length >= 3 ? 'lg:grid-cols-2 2xl:grid-cols-3' : sections.length === 2 ? 'lg:grid-cols-2' : 'max-w-3xl';
  const DOT = { submitted: 'bg-emerald-500', partial: 'bg-gold-500', draft: 'bg-gold-500', reopened: 'bg-red-500', none: 'bg-ink-300' };

  return (
    <div className="space-y-5">
      {/* Contestant picker: stays under the top bar while scrolling */}
      <div className="sticky top-14 z-10 -mx-4 border-y border-ink-200 bg-white px-4 py-2.5 sm:mx-0 sm:rounded-xl sm:border">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-ink-600">
            <span className="font-semibold text-ink-900">Contestants</span> · {submittedCount} of {contestants.length} fully submitted
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="xs" icon={ChevronLeft} disabled={idx <= 0} onClick={() => select(String(contestants[idx - 1]._id))}>
              Prev
            </Button>
            <Button variant="secondary" size="xs" disabled={idx >= contestants.length - 1} onClick={() => select(String(contestants[idx + 1]._id))}>
              Next <ChevronRight className="size-3.5" />
            </Button>
            {pendingTotal > 0 && (
              <Button variant="subtle" size="xs" icon={CheckCheck} onClick={submitAll} loading={busy === 'all'}>
                Submit all remaining
              </Button>
            )}
          </div>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {contestants.map((c) => {
            const stKey = statusOf(c._id);
            const active = String(c._id) === selected;
            return (
              <button
                key={c._id}
                type="button"
                onClick={() => select(String(c._id))}
                title={`${c.name} · ${STATUS[stKey].label}`}
                className={cx(
                  'flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-left text-[13px] transition-colors',
                  active ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-brand-300'
                )}
              >
                <span className={cx('size-1.5 shrink-0 rounded-full', DOT[stKey])} />
                <span className="font-semibold tabular-nums">{c.number}</span>
                <span className="max-w-[120px] truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {contestant && (
        <>
          <Card className="flex flex-wrap items-center gap-3.5 p-4">
            <Avatar name={contestant.name} src={contestant.photo} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-ink-900">
                  <span className="mr-1.5 text-brand-600">#{contestant.number}</span>
                  {contestant.name}
                </h2>
                <Badge tone={st.tone} dot>
                  {st.label}
                </Badge>
              </div>
              {contestant.representing && <p className="text-sm text-ink-500">{contestant.representing}</p>}
              {contestant.isTeam && contestant.members?.length > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-500">
                  <Users className="mt-0.5 size-3.5 shrink-0" /> {contestant.members.join(', ')}
                </p>
              )}
              {contestant.description && <p className="mt-2 text-sm text-ink-600">{contestant.description}</p>}
            </div>
          </Card>

          {/* Categories side by side */}
          <div className={cx('grid items-start gap-3', cols)}>
            {sections.map((d) => {
              const sheet = sheets[key(d.category._id, selected)];
              const locked = isLocked(d);
              const errors = errorsFor(d);
              const pv = preview(d.criteria, values[d.category._id]);
              const filled = d.criteria.filter((c) => (values[d.category._id]?.[c.criterionId] ?? '') !== '').length;
              return (
                <section key={d.category._id} id={`cat-${d.category._id}`} className="scroll-mt-44 overflow-hidden rounded-xl border border-ink-200 border-t-[3px] border-t-navy-900 bg-white">
                  <div className="border-b border-ink-200 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-semibold text-ink-900">{d.category.name}</h3>
                        <p className="text-xs text-ink-500">{d.category.methodLabel}</p>
                      </div>
                      {sheet?.status === 'submitted' ? (
                        <Badge tone="green">
                          <Lock className="size-3" /> Submitted
                        </Badge>
                      ) : !d.category.scoringOpen ? (
                        <Badge>
                          <Lock className="size-3" /> Closed
                        </Badge>
                      ) : sheet?.status === 'reopened' ? (
                        <Badge tone="red">Reopened</Badge>
                      ) : (
                        <span className="text-xs text-ink-500 tabular-nums">
                          {filled}/{d.criteria.length} scored
                        </span>
                      )}
                    </div>
                    {d.category.instructions && <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line text-ink-600">{d.category.instructions}</p>}
                  </div>

                  {sheet?.status === 'reopened' && (
                    <div className="px-4 pt-3">
                      <Alert tone="red" icon={RotateCcw} title="Reopened for correction">
                        {sheet.reopenReason}
                      </Alert>
                    </div>
                  )}
                  {sheet?.status === 'submitted' && <p className="border-b border-ink-100 bg-ink-50 px-4 py-2 text-xs text-ink-600">Submitted {formatDateTime(sheet.submittedAt)}. Ask the event administrator if a correction is needed.</p>}

                  <ol className="divide-y divide-ink-100">
                    {d.criteria.map((c, n) => {
                      const err = errors[c.criterionId];
                      const i = locked ? null : ++inputIndex;
                      return (
                        <li key={c.criterionId} className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink-900">
                                {n + 1}. {c.name}
                              </p>
                              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-500">
                                <span className="font-medium text-ink-700">{c.weight}%</span>
                                <span>
                                  Score {c.minScore}–{c.maxScore}
                                  {c.decimalPlaces ? ` · up to ${c.decimalPlaces} decimal${c.decimalPlaces > 1 ? 's' : ''}` : ' · whole numbers'}
                                </span>
                              </p>
                            </div>
                            <div className="w-24 shrink-0">
                              <Input
                                ref={(el) => {
                                  if (i !== null) inputs.current[i] = el;
                                }}
                                type="number"
                                inputMode="decimal"
                                min={c.minScore}
                                max={c.maxScore}
                                step={c.decimalPlaces ? 1 / 10 ** c.decimalPlaces : 1}
                                disabled={locked}
                                value={values[d.category._id]?.[c.criterionId] ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setValues((all) => ({ ...all, [d.category._id]: { ...all[d.category._id], [c.criterionId]: v } }));
                                  setDirty((s) => new Set(s).add(d.category._id));
                                }}
                                onKeyDown={(e) => i !== null && onKey(e, i)}
                                invalid={!!err}
                                placeholder={`/${c.maxScore}`}
                                aria-label={`${c.name} score`}
                                className="h-9 text-center text-base font-semibold tabular-nums"
                              />
                              {err && <p className="mt-1 text-center text-[11px] text-red-700">{err}</p>}
                            </div>
                          </div>
                          {c.description && <p className="mt-2 rounded-md bg-ink-50 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-line text-ink-600">{c.description}</p>}
                        </li>
                      );
                    })}
                  </ol>

                  <div className="flex items-center justify-between gap-3 border-t border-ink-200 bg-ink-50 px-4 py-2.5 text-[13px] text-ink-500">
                    <span>Preview</span>
                    <span className="tabular-nums">
                      Total <span className="font-semibold text-ink-900">{num(pv.total)}</span>
                      <span className="mx-2 text-ink-300">|</span>
                      Weighted <span className="font-semibold text-brand-700">{num(pv.weighted)}</span>
                    </span>
                  </div>
                </section>
              );
            })}
          </div>

          {editable.length > 0 && (
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-lg">
              <p className="text-[13px] text-ink-500">
                {editable.length > 1 ? (
                  <>
                    {editable.length} categories will be saved and submitted together.
                  </>
                ) : (
                  'Totals are previews; official scores are computed by the server.'
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" icon={Save} onClick={() => saveDraft()} loading={busy === 'save'} disabled={!dirty.size}>
                  Save draft
                </Button>
                <Button icon={Send} onClick={submit} loading={busy === 'submit'} disabled={!allComplete || hasErrors}>
                  Review & submit
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rank-based category (whole ranking at once)
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

  const saveAll = async () => {
    setBusy('save');
    try {
      for (const c of contestants) {
        const r = ranks[String(c._id)];
        await api.put(`/judging/categories/${category._id}/sheets/${c._id}`, { rank: r ? Number(r) : null });
      }
      toast.success('Draft rankings saved');
    } catch (err) {
      showError(err, 'Could not save');
    } finally {
      setBusy('');
    }
  };

  const submit = async () => {
    if (!complete) return showError({ response: { data: { message: `Give every contestant a unique rank from 1 to ${n}.` } } }, 'Incomplete ranking');
    if (!(await confirmAction({ title: `Submit your ranking for ${category.name}?`, text: 'Your ranking will be locked and can only be changed through an authorized correction.', confirmText: 'Submit ranking' }))) return;
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
      <div id={`cat-${category._id}`} className="scroll-mt-20">
        <CardHeader title={category.name} description={`Rank each contestant from 1 (best) to ${n}. Each rank is used once.`} actions={allSubmitted ? <Badge tone="green">Submitted</Badge> : !category.scoringOpen ? <Badge>Scoring closed</Badge> : null} />
      </div>
      {category.instructions && <p className="border-b border-ink-100 px-5 py-2 text-xs text-ink-600">{category.instructions}</p>}
      {sheets.some((s) => s.status === 'reopened') && (
        <div className="px-5 pt-4">
          <Alert tone="red" icon={RotateCcw} title="Ranking reopened for correction">
            {sheets.find((s) => s.status === 'reopened')?.reopenReason}
          </Alert>
        </div>
      )}
      <ul className="divide-y divide-ink-100">
        {contestants.map((c) => {
          const r = ranks[String(c._id)];
          const dup = r && duplicates.includes(Number(r));
          return (
            <li key={c._id} className="flex items-center gap-4 px-5 py-3">
              <span className="w-8 text-center text-ink-500 tabular-nums">#{c.number}</span>
              <Avatar name={c.name} src={c.photo} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-800">{c.name}</p>
                {c.representing && <p className="text-xs text-ink-500">{c.representing}</p>}
              </div>
              <div className="w-32">
                <Select disabled={locked} value={r} onChange={(e) => setRanks({ ...ranks, [String(c._id)]: e.target.value })} className={cx(dup && 'border-red-500')}>
                  <option value="">Rank…</option>
                  {Array.from({ length: n }, (_, i) => i + 1).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </Select>
                {dup && <p className="mt-0.5 text-[11px] text-red-700">Rank used twice</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {!locked && (
        <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3.5">
          <Button variant="secondary" icon={Save} onClick={saveAll} loading={busy === 'save'}>
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

// ------------------------------------------------------------------ page
export default function EventScoringPage() {
  const { eventId } = useParams();
  const [params] = useSearchParams();
  const focusCategory = params.get('category');
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: a } = await api.get('/judging/assignments');
      const assignment = a.items.find((x) => String(x.event._id) === String(eventId));
      if (!assignment) throw new Error('You are not assigned to judge this event.');
      const details = await Promise.all(assignment.categories.map((c) => api.get(`/judging/categories/${c._id}`).then((r) => r.data)));
      setState({ event: assignment.event, seat: assignment.seat, categories: details, multipleEvents: a.items.length > 1 });
      setError('');
    } catch (err) {
      setError(err.response ? apiErrorMessage(err) : err.message);
    }
  }, [eventId]);
  useEffect(() => {
    load();
  }, [load]);

  useEventSocket(eventId, { 'category:updated': () => load(), 'sheet:reopened': () => load() });

  if (error) return <EmptyState title="Unable to open the score sheet" description={error} action={<Link to="/app/judging" className="text-sm font-medium text-brand-700">Back to my assignments</Link>} />;
  if (!state) return <PageSkeleton />;

  const { event, seat, categories, multipleEvents } = state;
  // The server only sends contestants once a category's configuration is locked for scoring
  const ready = (d) => d.category.configLocked && d.contestants.length > 0;
  const notOpen = categories.filter((d) => !ready(d));
  const criteriaCats = categories.filter((d) => ready(d) && d.category.usesCriteria);
  const rankCats = categories.filter((d) => ready(d) && !d.category.usesCriteria);
  const anyOpen = categories.some((d) => d.category.scoringOpen);

  return (
    <div>
      {multipleEvents && (
        <Link to="/app/judging" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
          <ChevronLeft className="size-4" /> My events
        </Link>
      )}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-ink-200 pb-4">
        <div>
          <p className="text-xs font-medium text-brand-600">Judge {seat} score sheet</p>
          <h1 className="mt-0.5 text-xl font-semibold text-ink-900">{event.name}</h1>
          <p className="mt-1 text-sm text-ink-500">{categories.map((d) => d.category.name).join(' · ')}</p>
        </div>
        {anyOpen ? (
          <Badge tone="brand" dot>
            Scoring open
          </Badge>
        ) : (
          <Badge>
            <Lock className="size-3" /> Not open
          </Badge>
        )}
      </div>

      {notOpen.length > 0 && (
        <Alert tone="gray" icon={Lock} className="mb-5">
          Not open yet: {notOpen.map((d) => d.category.name).join(', ')}. {notOpen.length === 1 ? 'It' : 'They'} will appear here automatically once the organizers open scoring.
        </Alert>
      )}

      {!criteriaCats.length && !rankCats.length ? (
        <Card>
          <EmptyState icon={Lock} title="Scoring has not opened yet" description="The organizers will open your categories when the competition begins. This page updates automatically." />
        </Card>
      ) : (
        <div className="space-y-6">
          {criteriaCats.length > 0 && <CombinedCriteriaScoring cats={criteriaCats} reload={load} focusCategory={focusCategory} />}
          {rankCats.map((d) => (
            <RankScoring key={`${d.category._id}-${d.sheets.map((s) => s.status).join()}`} data={d} reload={load} />
          ))}
        </div>
      )}
    </div>
  );
}
