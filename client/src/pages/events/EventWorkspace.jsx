import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { BarChart3, ChevronLeft, ClipboardList, ClipboardPen, FileText, Info, Layers, MonitorCheck, ScrollText, UserRound, Users } from 'lucide-react';
import api, { apiErrorMessage } from '../../api/client';
import { EmptyState, PageSkeleton, TabNav } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { eventTypeLabel, formatDate } from '../../lib/format';
import { useEventSocket } from '../../lib/socket';

export default function EventWorkspace() {
  const { eventId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    return api
      .get(`/events/${eventId}`)
      .then(({ data: d }) => setData(d))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [eventId]);

  useEffect(() => {
    setData(null);
    setError('');
    reload();
  }, [reload]);

  // Keep header counts fresh while staff work in the event
  useEventSocket(eventId, { 'result:updated': reload, 'category:updated': reload });

  if (error) return <EmptyState title="Event unavailable" description={error} action={<Link to="/app/events" className="text-sm font-medium text-brand-600">Back to events</Link>} />;
  if (!data) return <PageSkeleton />;

  const { event, can, counts } = data;
  const base = `/app/events/${eventId}`;
  const tabs = [
    { to: base, label: 'Overview', icon: Info, end: true },
    { to: `${base}/categories`, label: 'Categories & Criteria', icon: Layers, count: counts.categories },
    { to: `${base}/contestants`, label: 'Contestants', icon: UserRound, count: counts.contestants },
    { to: `${base}/staff`, label: 'Judges', icon: Users, count: counts.judges },
    ...(can.manage ? [{ to: `${base}/encode`, label: 'Encode Scores', icon: ClipboardPen }] : []),
    { to: `${base}/monitoring`, label: 'Monitoring', icon: MonitorCheck },
    { to: `${base}/tally`, label: 'Tally & Results', icon: BarChart3 },
    { to: `${base}/reports`, label: 'Reports', icon: FileText },
    ...(can.manage ? [{ to: `${base}/audit`, label: 'Audit Trail', icon: ScrollText }] : []),
  ];

  return (
    <div>
      <Link to="/app/events" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800">
        <ChevronLeft className="size-4" /> Events
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{event.name}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {eventTypeLabel(event.eventType)} · {formatDate(event.eventDate, { dateStyle: 'long' })}
            {event.venue && ` · ${event.venue}`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <ClipboardList className="size-4" />
          {counts.submittedSheets} of {counts.sheets} started score sheets submitted
        </div>
      </div>
      <TabNav items={tabs} />
      <Outlet context={{ event, can, counts, reload }} />
    </div>
  );
}
