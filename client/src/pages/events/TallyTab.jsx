import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { BarChart3, Calculator, CheckCircle2, ChevronRight, FileDown, RefreshCcw, Trophy, TriangleAlert } from 'lucide-react';
import api from '../../api/client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, SegmentedControl, Select, TableSkeleton } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';
import { AwardsPanel, CategoryTallyTable, MissingPanel, OverallTallyTable, TiesPanel } from './TallyTable';

function Versions({ results, eventId }) {
  if (!results?.length) return <p className="px-5 py-6 text-sm text-slate-500">No saved versions yet.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {results.map((r) => (
        <li key={r._id}>
          <Link to={`/app/events/${eventId}/results/${r._id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
            <div>
              <p className="text-sm font-medium text-slate-800">
                Version {r.version} {!r.complete && <span className="text-xs font-normal text-amber-600">· incomplete</span>}
              </p>
              <p className="text-xs text-slate-500">Generated {formatDateTime(r.generatedAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge kind="result" status={r.status} />
              <ChevronRight className="size-4 text-slate-400" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function TallyTab() {
  const { event, can } = useOutletContext();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState(null);
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('judges');
  const [busy, setBusy] = useState(false);
  const selection = params.get('category') || '';
  const isOverall = selection === 'overall';

  useEffect(() => {
    api
      .get(`/events/${event._id}/categories`)
      .then(({ data: d }) => {
        setCategories(d.items);
        if (!selection && d.items.length) setParams({ category: (d.items.find((c) => c.configLocked) || d.items[0])._id }, { replace: true });
      })
      .catch((err) => {
        setCategories([]);
        showError(err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event._id]);

  const load = useCallback(async () => {
    if (!selection) return;
    try {
      const url = isOverall ? `/events/${event._id}/overall` : `/categories/${selection}/tally`;
      const { data: d } = await api.get(url);
      setData(d);
    } catch (err) {
      showError(err, 'Could not compute tally');
    }
  }, [selection, isOverall, event._id]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  useEventSocket(event._id, {
    'sheet:submitted': (p) => (isOverall || p.categoryId === selection) && load(),
    'sheet:reopened': (p) => (isOverall || p.categoryId === selection) && load(),
    'result:updated': () => load(),
  });

  const generate = async () => {
    const tally = data?.tally;
    const ok = await confirmAction({
      title: 'Save a new result version?',
      text: tally?.complete
        ? 'The backend will recompute the tally from all submitted score sheets and store it as a preliminary result for verification.'
        : 'Some score sheets are missing. This version will be marked INCOMPLETE and cannot be submitted for approval until all sheets are in.',
      confirmText: 'Generate version',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const url = isOverall ? `/events/${event._id}/overall/results` : `/categories/${selection}/results`;
      const { data: d } = await api.post(url);
      toast.success(`Version ${d.result.version} saved`);
      navigate(`/app/events/${event._id}/results/${d.result._id}`);
    } catch (err) {
      showError(err, 'Could not generate result');
    } finally {
      setBusy(false);
    }
  };

  if (categories === null) return <Card><TableSkeleton /></Card>;
  if (!categories.length) return <Card><EmptyState icon={BarChart3} title="No categories yet" description="Create categories and open scoring to see the tally." /></Card>;

  const tally = data?.tally;
  const canGenerate = can.tabulate && event.status !== 'archived' && (isOverall ? data?.enabled && tally : data?.locked);
  const activeLocked = data?.results?.find((r) => ['for_approval', 'approved', 'published'].includes(r.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={selection} onChange={(e) => setParams({ category: e.target.value })} className="w-full sm:w-80">
          {event.overall?.enabled && <option value="overall">★ {event.overall.title || 'Overall tally'}</option>}
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
              {c.configLocked ? '' : ' (setup)'}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-2">
          {!isOverall && tally && tally.scoringMethod !== 'rank' && (
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: 'judges', label: 'Judge scores' },
                { value: 'criteria', label: 'Criteria breakdown' },
              ]}
            />
          )}
          <Button variant="ghost" size="sm" icon={RefreshCcw} onClick={load}>
            Recompute
          </Button>
          <Link to={`/app/events/${event._id}/reports${isOverall ? '' : `?category=${selection}`}`}>
            <Button variant="secondary" size="sm" icon={FileDown}>
              Reports
            </Button>
          </Link>
          {canGenerate && (
            <Button size="sm" icon={Calculator} onClick={generate} loading={busy} disabled={!!activeLocked} title={activeLocked ? `Version ${activeLocked.version} is ${activeLocked.status}` : undefined}>
              Generate result version
            </Button>
          )}
        </div>
      </div>

      {!data ? (
        <Card>
          <TableSkeleton rows={6} cols={6} />
        </Card>
      ) : isOverall && !data.enabled ? (
        <Alert tone="gray" title="Overall tally is not enabled">
          Enable it on the Overview tab and choose the included categories.
        </Alert>
      ) : isOverall && data.error ? (
        <Alert tone="amber" icon={TriangleAlert} title="Overall tally unavailable">
          {data.error}
        </Alert>
      ) : (
        <div className="grid gap-6 2xl:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-6">
            {!isOverall && !data.locked && (
              <Alert tone="gray" icon={TriangleAlert} title="Preview only — scoring has not opened">
                This tally uses the editable configuration. Lock the category to begin official scoring.
              </Alert>
            )}
            {tally && (
              <Alert tone={tally.complete ? 'green' : 'amber'} icon={tally.complete ? CheckCircle2 : TriangleAlert} title={tally.complete ? 'All required score sheets are submitted' : 'PRELIMINARY — incomplete score sheets'}>
                {tally.complete
                  ? 'Rankings below are computed by the backend scoring engine. Generate a result version to start verification.'
                  : event.settings?.allowIncompleteRanking
                    ? 'This event allows rankings with incomplete sheets, but missing sheets are listed below.'
                    : 'Rankings are not official until every assigned judge submits every sheet.'}
                {!isOverall && tally.summary && (
                  <span className="mt-1 block text-xs">
                    {tally.summary.submittedSheets}/{tally.summary.expectedSheets} sheets · {tally.summary.judges} judges · {tally.summary.contestants} contestants · {tally.methodLabel}
                  </span>
                )}
              </Alert>
            )}
            {tally?.warnings?.length > 0 && (
              <Alert tone="amber" icon={TriangleAlert} title="Warnings">
                <ul className="list-disc pl-4">
                  {tally.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <Card>
              <CardHeader
                title={isOverall ? event.overall.title : `${data.category.name} — ${tally.methodLabel}`}
                description={isOverall ? (event.overall.method === 'weighted' ? 'Σ (normalized category score × category weight)' : 'Sum of category ranks — lowest wins') : tally.direction === 'asc' ? 'Lower totals rank higher.' : 'Higher scores rank higher.'}
                actions={<Badge tone="brand">Live computation</Badge>}
              />
              {tally?.rows?.length ? (
                isOverall ? <OverallTallyTable tally={tally} extras={data.extras} /> : <CategoryTallyTable tally={tally} extras={data.extras} mode={mode} />
              ) : (
                <EmptyState icon={Trophy} title="Nothing to rank yet" />
              )}
            </Card>

            {!isOverall && tally?.awards?.length > 0 && (
              <Card>
                <CardHeader title="Special awards" description={tally.complete ? 'Derived from the tally above.' : 'Preliminary — may change until all score sheets are in.'} />
                <AwardsPanel awards={tally.awards} extras={data.extras} decimalPlaces={tally.decimalPlaces} />
              </Card>
            )}
            {tally?.ties?.length > 0 && (
              <Card>
                <CardHeader title="Tie detection" description="Ties are resolved only by the configured rules; unresolved ties share the rank." />
                <div className="p-5">
                  <TiesPanel ties={tally.ties} />
                </div>
              </Card>
            )}
            {!isOverall && tally?.missing?.length > 0 && (
              <Card>
                <CardHeader title={`Missing or incomplete score sheets (${tally.missing.length})`} />
                <div className="bg-amber-50/40 p-5">
                  <MissingPanel missing={tally.missing} />
                </div>
              </Card>
            )}
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Result versions" description="Saved tallies and their approval status" />
              <Versions results={data.results} eventId={event._id} />
            </Card>
            {!can.tabulate && (
              <p className="px-1 text-xs text-slate-500">Result versions are generated by the assigned Tabulator. Administrators review and approve them.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
