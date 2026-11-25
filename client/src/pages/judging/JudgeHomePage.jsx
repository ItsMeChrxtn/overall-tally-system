import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, Clock3, Lock, MapPin } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Card, CardHeader, EmptyState, PageHeader, PageSkeleton, ProgressBar, StatCard, StatGroup } from '../../components/ui';
import { eventTypeLabel, formatDate } from '../../lib/format';
import { showError } from '../../lib/alerts';
import { useSocketEvent } from '../../lib/socket';

export default function JudgeHomePage() {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [dash, setDash] = useState(null);

  const load = () => {
    Promise.all([api.get('/judging/assignments'), api.get('/dashboard')])
      .then(([a, d]) => {
        setItems(a.data.items);
        setDash(d.data);
      })
      .catch((err) => {
        setItems([]);
        showError(err);
      });
  };
  useEffect(load, []);
  useSocketEvent('notification', load);

  if (!items || !dash) return <PageSkeleton />;
  // One event: nothing to choose, go straight to the score sheet
  if (items.length === 1) return <Navigate to={`/app/judging/event/${items[0].event._id}`} replace />;

  return (
    <div>
      <PageHeader eyebrow="Judge" title={user.name} description="Each event opens as one score sheet covering all of your categories." />
      <StatGroup className="mb-6 grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assigned events" value={dash.stats.assignedEvents} icon={CalendarClock} />
        <StatCard label="Open categories" value={dash.stats.openCategories} icon={ClipboardCheck} tone="brand" />
        <StatCard label="Pending score sheets" value={dash.stats.pendingSheets} icon={Clock3} tone="amber" />
        <StatCard label="Completed evaluations" value={dash.stats.completedEvaluations} icon={CheckCircle2} tone="green" />
      </StatGroup>

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardCheck} title="No assignments yet" description="The event organizer will assign you to categories before the competition." />
        </Card>
      ) : (
        <div className="space-y-6">
          {items.map(({ event, categories, seat }) => (
            <Card key={event._id}>
              <CardHeader
                title={event.name}
                description={
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{eventTypeLabel(event.eventType)}</span>
                    <span>{formatDate(event.eventDate, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    {event.venue && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" /> {event.venue}
                      </span>
                    )}
                  </span>
                }
                actions={
                  <>
                    <Badge tone="brand">Judge {seat}</Badge>
                    <Link to={`/app/judging/event/${event._id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-[13px] font-medium text-white hover:bg-brand-700">
                      Open score sheet <ArrowRight className="size-4" />
                    </Link>
                  </>
                }
              />
              <ul className="divide-y divide-ink-100">
                {categories.map((c) => {
                  const open = c.configLocked && c.status === 'scoring';
                  const done = c.submitted >= c.contestants && c.contestants > 0;
                  return (
                    <li key={c._id}>
                      <Link to={`/app/judging/event/${event._id}?category=${c._id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-ink-50">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-ink-900">{c.name}</p>
                            {!c.configLocked ? (
                              <Badge>
                                <Lock className="size-3" /> Not open yet
                              </Badge>
                            ) : open ? (
                              done ? <Badge tone="green">Completed</Badge> : <Badge tone="brand" dot>Scoring open</Badge>
                            ) : (
                              <Badge tone="blue">Scoring closed</Badge>
                            )}
                            {c.drafts > 0 && <Badge tone="amber">{c.drafts} draft{c.drafts > 1 ? 's' : ''}</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-ink-500">{c.methodLabel}</p>
                          {c.configLocked && (
                            <div className="mt-2 flex max-w-sm items-center gap-2">
                              <ProgressBar value={c.submitted} max={c.contestants} className="flex-1" />
                              <span className="text-xs text-ink-500 tabular-nums">
                                {c.submitted}/{c.contestants}
                              </span>
                            </div>
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
