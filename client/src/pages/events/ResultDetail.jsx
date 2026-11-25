import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, CircleCheckBig, EyeOff, FileSpreadsheet, FileText, Globe, Printer, Send, TriangleAlert, Undo2 } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Button, Card, CardHeader, PageSkeleton, SegmentedControl } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { formatDateTime, titleCase } from '../../lib/format';
import { confirmAction, promptReason, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';
import { exportExcel, exportPdf, printReport } from '../../lib/reportExport';
import { AwardsPanel, CategoryTallyTable, MissingPanel, OverallTallyTable, TiesPanel } from './TallyTable';

const STEPS = [
  { key: 'preliminary', label: 'Preliminary' },
  { key: 'approved', label: 'Final' },
  { key: 'published', label: 'Published' },
];

function Stepper({ status }) {
  // Older results may still be "for approval": show them as not yet final
  const idx = STEPS.findIndex((s) => s.key === (status === 'for_approval' ? 'preliminary' : status));
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((s, i) => {
        const done = idx >= i;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500'}`}>{done ? <CheckCircle2 className="size-3.5" /> : i + 1}</span>
            <span className={`text-sm ${done ? 'font-medium text-ink-800' : 'text-ink-400'}`}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-ink-200" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function ResultDetail() {
  const { resultId } = useParams();
  const { event, can, reload: reloadEvent } = useOutletContext();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('judges');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    return api
      .get(`/results/${resultId}`)
      .then(({ data: d }) => setData(d))
      .catch((err) => showError(err, 'Could not load result'));
  }, [resultId]);
  useEffect(() => {
    load();
  }, [load]);
  useEventSocket(event._id, { 'result:updated': (p) => p.resultId === resultId && load() });

  const act = async (kind) => {
    let note;
    if (kind === 'return' || kind === 'unpublish') {
      note = await promptReason({ title: kind === 'return' ? 'Reopen results for correction' : 'Unpublish results', text: 'Explain why. This is recorded in the approval history and audit trail.', confirmText: titleCase(kind) });
      if (!note) return;
    } else if (kind === 'submit') {
      note = await promptReason({ title: 'Submit for approval', text: 'Optional verification note for the approver (e.g. “Checked against printed judge sheets”).', confirmText: 'Submit for approval', required: false, minLength: 0, placeholder: 'Verification note (optional)' });
      if (note === null) return;
    } else {
      const texts = {
        finalize: ['Finalize these results?', 'The system re-checks the tally against the current score sheets, then marks this version as FINAL. Scores in this category are locked until you reopen it for correction.'],
        approve: ['Approve these results?', 'The backend will re-verify the computation against current score sheets before approving.'],
        publish: ['Publish to the public results page?', 'Anyone will be able to see the final rankings and awardees.'],
      };
      if (!(await confirmAction({ title: texts[kind][0], text: texts[kind][1], confirmText: kind === 'finalize' ? 'Finalize' : titleCase(kind) }))) return;
    }
    setBusy(kind);
    try {
      await api.post(`/results/${resultId}/${kind}`, note ? { note } : {});
      toast.success({ finalize: 'Results finalized', submit: 'Submitted for approval', approve: 'Results approved', return: 'Reopened for correction', publish: 'Results published', unpublish: 'Results unpublished' }[kind]);
      await load();
      reloadEvent();
    } catch (err) {
      showError(err, `Could not ${kind}`);
    } finally {
      setBusy('');
    }
  };

  const exportAs = async (format) => {
    const params = { result: resultId, ...(result.category ? { category: result.category._id } : {}) };
    const type = 'tally';
    setBusy(format);
    try {
      if (format === 'xlsx') await exportExcel(event._id, type, params);
      else if (format === 'pdf') await exportPdf(event._id, type, params);
      else await printReport(event._id, type, params);
    } catch (err) {
      showError(err, 'Export failed');
    } finally {
      setBusy('');
    }
  };

  if (!data) return <PageSkeleton />;
  const { result, history, extras } = data;
  const isOverall = result.scope === 'overall';
  const tally = { ...result, awardees: result.category?.awardees ?? 3, methodLabel: result.summary?.methodLabel, categories: isOverall ? result.criteria : undefined };
  const s = result.status;

  return (
    <div className="space-y-6">
      <Link to={`/app/events/${event._id}/tally?category=${isOverall ? 'overall' : result.category?._id}`} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
        <ChevronLeft className="size-4" /> Back to tally
      </Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink-900">
                {result.title} <span className="font-normal text-ink-400">· Version {result.version}</span>
              </h2>
              <StatusBadge kind="result" status={s} />
              {!result.complete && <Badge tone="amber">Incomplete</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {result.summary?.methodLabel} · Generated by {result.generatedBy?.name} on {formatDateTime(result.generatedAt)}
              {result.configVersion && ` · Config v${result.configVersion}`}
            </p>
            <div className="mt-4">{s === 'returned' || s === 'superseded' ? <Badge tone={s === 'returned' ? 'red' : 'gray'}>{titleCase(s)}</Badge> : <Stepper status={s} />}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={FileText} loading={busy === 'pdf'} onClick={() => exportAs('pdf')}>
              PDF
            </Button>
            <Button variant="secondary" size="sm" icon={FileSpreadsheet} loading={busy === 'xlsx'} onClick={() => exportAs('xlsx')}>
              Excel
            </Button>
            <Button variant="secondary" size="sm" icon={Printer} loading={busy === 'print'} onClick={() => exportAs('print')}>
              Print
            </Button>
          </div>
        </div>
        {event.status !== 'archived' && (
          <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">
            {['preliminary', 'for_approval'].includes(s) && can.approve && (
              <Button size="sm" variant="success" icon={CircleCheckBig} loading={busy === 'finalize'} onClick={() => act('finalize')} disabled={!result.complete && !event.settings?.allowIncompleteRanking}>
                Finalize results
              </Button>
            )}
            {s === 'preliminary' && can.tabulate && !can.approve && (
              <Button size="sm" icon={Send} loading={busy === 'submit'} onClick={() => act('submit')} disabled={!result.complete && !event.settings?.allowIncompleteRanking}>
                Submit for approval
              </Button>
            )}
            {s === 'approved' && can.approve && (
              <>
                <Button size="sm" icon={Globe} loading={busy === 'publish'} onClick={() => act('publish')}>
                  Publish results
                </Button>
                <Button size="sm" variant="secondary" icon={Undo2} loading={busy === 'return'} onClick={() => act('return')}>
                  Reopen for correction
                </Button>
              </>
            )}
            {s === 'published' && can.approve && (
              <Button size="sm" variant="secondary" icon={EyeOff} loading={busy === 'unpublish'} onClick={() => act('unpublish')}>
                Unpublish
              </Button>
            )}
            <span className="text-xs text-ink-500">
              {['preliminary', 'for_approval'].includes(s) && (result.complete || event.settings?.allowIncompleteRanking ? 'Check the tally, then finalize it.' : 'Incomplete versions cannot be finalized.')}
              {s === 'approved' && 'Final. You can now download the reports or publish the results.'}
              {s === 'published' && `Public since ${formatDateTime(result.publishedAt)}.`}
              {s === 'returned' && `Reopened: ${result.returnReason}. Correct the scores and generate a new version.`}
              {s === 'superseded' && 'A newer version replaced this one.'}
            </span>
            {user.role === 'super_admin' && s === 'published' && (
              <a href={`/results/${event._id}`} target="_blank" rel="noreferrer" className="ml-auto text-xs font-medium text-brand-600">
                View public page
              </a>
            )}
          </div>
        )}
      </Card>

      {!result.complete && (
        <Alert tone="amber" icon={TriangleAlert} title="This version was generated with missing score sheets">
          It is preliminary only and cannot become official unless the event explicitly allows incomplete rankings.
        </Alert>
      )}

      <div className="grid gap-6 2xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Tabulated results"
              description="Stored exactly as computed by the backend engine at generation time."
              actions={
                !isOverall &&
                result.scoringMethod !== 'rank' && (
                  <SegmentedControl
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'judges', label: 'Judge scores' },
                      { value: 'criteria', label: 'Criteria breakdown' },
                    ]}
                  />
                )
              }
            />
            {isOverall ? <OverallTallyTable tally={tally} extras={extras} /> : <CategoryTallyTable tally={tally} extras={extras} mode={mode} />}
          </Card>
          {result.awards?.length > 0 && (
            <Card>
              <CardHeader title="Special awards" description="Stored with this version at generation time." />
              <AwardsPanel awards={result.awards} extras={extras} decimalPlaces={result.decimalPlaces} />
            </Card>
          )}
          {result.ties?.length > 0 && (
            <Card>
              <CardHeader title="Tie-breaking decisions" />
              <div className="p-5">
                <TiesPanel ties={result.ties} />
              </div>
            </Card>
          )}
          {result.missing?.length > 0 && (
            <Card>
              <CardHeader title="Missing score sheets at generation time" />
              <div className="bg-amber-50/40 p-5">
                <MissingPanel missing={result.missing} />
              </div>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="History" />
          <ol className="relative space-y-5 px-5 py-4">
            {history.map((h) => (
              <li key={h._id} className="relative pl-6">
                <span className="absolute top-1.5 left-0 size-2.5 rounded-full bg-brand-500 ring-4 ring-brand-50" />
                <p className="text-sm font-medium text-ink-800 capitalize">{{ approved: 'Finalized', returned: 'Reopened for correction' }[h.action] || h.action}</p>
                <p className="text-xs text-ink-500">
                  {h.byName} ({titleCase(h.byRole)}) · {formatDateTime(h.createdAt)}
                </p>
                {h.note && <p className="mt-1 rounded-md bg-ink-50 px-2 py-1 text-xs text-ink-600">{h.note}</p>}
              </li>
            ))}
          </ol>
          <div className="space-y-1 border-t border-ink-100 px-5 py-4 text-xs text-ink-500">
            <p>Prepared by: <span className="text-ink-700">{result.generatedBy?.name || '—'}</span></p>
            <p>Finalized by: <span className="text-ink-700">{result.approvedBy?.name || '—'}</span></p>
            <p>Published by: <span className="text-ink-700">{result.publishedBy?.name || '—'}</span></p>
          </div>
        </Card>
      </div>
    </div>
  );
}
