import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, CircleDashed, History, MonitorCheck, RefreshCcw, RotateCcw, TriangleAlert } from 'lucide-react';
import api from '../../api/client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Modal, ProgressBar, Select, TableSkeleton, cx } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { formatDateTime, num, timeAgo } from '../../lib/format';
import { promptReason, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const CELL = {
  submitted: { icon: CheckCircle2, cls: 'bg-brand-50 text-brand-600 hover:bg-brand-100', label: 'Submitted' },
  draft: { icon: CircleDashed, cls: 'bg-amber-50 text-amber-600 hover:bg-amber-100', label: 'Draft' },
  reopened: { icon: RotateCcw, cls: 'bg-red-50 text-red-600 hover:bg-red-100', label: 'Reopened' },
  not_started: { icon: Circle, cls: 'bg-ink-50 text-ink-300', label: 'Not started' },
};

export default function MonitoringTab() {
  const { event, can } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState(null);
  const [progress, setProgress] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const categoryId = params.get('category') || '';

  useEffect(() => {
    api
      .get(`/events/${event._id}/categories`)
      .then(({ data }) => {
        setCategories(data.items);
        if (!categoryId && data.items.length) setParams({ category: (data.items.find((c) => c.configLocked) || data.items[0])._id }, { replace: true });
      })
      .catch((err) => {
        setCategories([]);
        showError(err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event._id]);

  const load = useCallback(async () => {
    if (!categoryId) return;
    try {
      const [p, s] = await Promise.all([api.get(`/categories/${categoryId}/progress`), api.get(`/categories/${categoryId}/sheets`)]);
      setProgress(p.data);
      setSheets(s.data);
      setLastUpdate(new Date());
    } catch (err) {
      showError(err);
    }
  }, [categoryId]);

  useEffect(() => {
    setProgress(null);
    load();
  }, [load]);

  useEventSocket(event._id, {
    'sheet:submitted': (p) => p.categoryId === categoryId && load(),
    'sheet:reopened': (p) => p.categoryId === categoryId && load(),
    'category:updated': (p) => p.categoryId === categoryId && load(),
  });

  const sheetById = useMemo(() => Object.fromEntries((sheets?.items || []).map((s) => [s._id, s])), [sheets]);
  const critName = (id) => sheets?.config.criteria.find((c) => String(c.criterionId) === String(id))?.name || 'Criterion';

  const openSheet = async (cell) => {
    if (!cell.sheetId) return;
    setSelected(sheetById[cell.sheetId]);
    setHistory(null);
    try {
      const { data } = await api.get(`/sheets/${cell.sheetId}`);
      setHistory(data.sheet.history);
    } catch {
      setHistory([]);
    }
  };

  const reopen = async () => {
    const reason = await promptReason({
      title: 'Reopen this score sheet for correction?',
      text: 'The judge will be notified to correct and re-submit. The previous values and your reason are kept in the audit trail.',
      confirmText: 'Reopen sheet',
    });
    if (!reason) return;
    try {
      await api.post(`/sheets/${selected._id}/reopen`, { reason });
      toast.success('Sheet reopened; the judge has been notified');
      setSelected(null);
      load();
    } catch (err) {
      showError(err, 'Cannot reopen sheet');
    }
  };

  if (categories === null) return <Card><TableSkeleton /></Card>;
  if (!categories.length) return <Card><EmptyState icon={MonitorCheck} title="No categories yet" /></Card>;

  const category = categories.find((c) => c._id === categoryId);
  const pctDone = progress?.expected ? Math.round((progress.submitted / progress.expected) * 100) : 0;
  const usesCriteria = sheets?.config.scoringMethod !== 'rank';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={categoryId} onChange={(e) => setParams({ category: e.target.value })} className="w-full sm:w-80">
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name} {c.configLocked ? '' : '(setup)'}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-3 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 animate-pulse rounded-full bg-brand-500" /> Live
          </span>
          {lastUpdate && <span>Updated {timeAgo(lastUpdate)}</span>}
          <Button variant="ghost" size="sm" icon={RefreshCcw} onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {!progress ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : !progress.locked ? (
        <Alert tone="gray" icon={TriangleAlert} title="Scoring has not opened for this category">
          Lock the configuration on the category page to let judges begin scoring.
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs font-medium text-ink-500">Submission progress</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {progress.submitted}
                <span className="text-base font-normal text-ink-400">/{progress.expected}</span>
              </p>
              <ProgressBar value={progress.submitted} max={progress.expected} className="mt-2" />
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium text-ink-500">Category status</p>
              <div className="mt-2">
                <StatusBadge kind="category" status={progress.status} />
              </div>
              <p className="mt-2 text-xs text-ink-500">{category?.latestResult ? `Latest result: v${category.latestResult.version} (${category.latestResult.status.replace('_', ' ')})` : 'No tally generated yet'}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium text-ink-500">Outstanding</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{progress.expected - progress.submitted}</p>
              <p className="text-xs text-ink-500">{pctDone === 100 ? 'All score sheets are in.' : 'Sheets not yet submitted'}</p>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Judge submission matrix"
              description="Click a cell to inspect the score sheet."
              actions={
                <div className="hidden gap-3 text-xs text-ink-500 md:flex">
                  {Object.entries(CELL).map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1">
                      <v.icon className={cx('size-3.5', v.cls.split(' ')[1])} /> {v.label}
                    </span>
                  ))}
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-ink-50">Judge</th>
                    {progress.contestants.map((c) => (
                      <th key={c.contestantId} className="text-center" title={c.name}>
                        #{c.number}
                      </th>
                    ))}
                    <th className="text-right">Done</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.matrix.map((j) => {
                    const done = j.cells.filter((c) => c.status === 'submitted').length;
                    return (
                      <tr key={j.judgeId}>
                        <td className="sticky left-0 z-10 bg-white font-medium whitespace-nowrap text-ink-800">{j.name}</td>
                        {j.cells.map((cell) => {
                          const cfg = CELL[cell.status] || CELL.not_started;
                          return (
                            <td key={cell.contestantId} className="text-center">
                              <button type="button" disabled={!cell.sheetId} onClick={() => openSheet(cell)} className={cx('inline-flex size-8 items-center justify-center rounded-md transition-colors', cfg.cls)} title={`${cfg.label}${cell.submittedAt ? ` · ${formatDateTime(cell.submittedAt)}` : ''}`}>
                                <cfg.icon className="size-4" />
                              </button>
                            </td>
                          );
                        })}
                        <td className="text-right text-xs whitespace-nowrap text-ink-500 tabular-nums">
                          {done}/{j.cells.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `#${selected.contestant?.number} ${selected.contestant?.name}` : ''}
        description={selected ? `Score sheet by ${selected.judge?.name}` : ''}
        footer={
          can.manage &&
          selected?.status === 'submitted' && (
            <Button variant="danger" icon={RotateCcw} onClick={reopen}>
              Reopen for correction
            </Button>
          )
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge kind="sheet" status={selected.status} />
              <span className="text-ink-500">{selected.submittedAt ? `Submitted ${formatDateTime(selected.submittedAt)}` : `Saved ${formatDateTime(selected.savedAt)}`}</span>
              <Badge>Config v{selected.configVersion}</Badge>
            </div>
            {selected.reopenReason && selected.status !== 'submitted' && <Alert tone="red" title="Reopened for correction">{selected.reopenReason}</Alert>}
            {usesCriteria ? (
              <table className="table-base rounded-lg border border-ink-200">
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th className="text-right">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.scores.map((s) => (
                    <tr key={s.criterion}>
                      <td>{critName(s.criterion)}</td>
                      <td className="text-right font-medium tabular-nums">{s.value}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold">Total / Weighted</td>
                    <td className="text-right font-semibold tabular-nums">
                      {num(selected.computedTotal)} / {num(selected.computedWeighted)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="text-sm">
                Rank given: <span className="font-semibold">{selected.rank ?? '—'}</span>
              </p>
            )}
            <div>
              <p className="mb-2 flex items-center gap-1.5 label-caps">
                <History className="size-3.5" /> Sheet history
              </p>
              {history === null ? (
                <p className="text-sm text-ink-400">Loading…</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-ink-500">No submissions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h, i) => (
                    <li key={i} className="rounded-lg border border-ink-100 px-3 py-2 text-xs">
                      <span className="font-medium text-ink-700 capitalize">{h.action}</span> by {h.by?.name || '—'} · {formatDateTime(h.at)}
                      {h.note && <p className="mt-0.5 text-ink-500">{h.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
