import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Award, CalendarDays, Crown, MapPin, Medal, Printer } from 'lucide-react';
import api, { apiErrorMessage, fileUrl } from '../../api/client';
import { Avatar, Badge, Button, EmptyState, Skeleton, cx } from '../../components/ui';
import { eventTypeLabel, formatDate, formatDateTime, num, ordinal } from '../../lib/format';

const PODIUM = ['from-amber-300 to-amber-500', 'from-slate-200 to-slate-400', 'from-orange-300 to-orange-500'];

function Podium({ rows, showScores }) {
  const top = rows.filter((r) => r.rank <= 3).slice(0, 3);
  if (!top.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {top.map((r) => (
        <div key={r.number} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-center">
          <div className={cx('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', PODIUM[r.rank - 1] || PODIUM[2])} />
          <div className="mx-auto mb-3 w-fit">
            <Avatar name={r.name} src={r.photo} size="xl" />
          </div>
          <p className="flex items-center justify-center gap-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {r.rank === 1 ? <Crown className="size-3.5 text-amber-500" /> : <Medal className="size-3.5" />}
            {ordinal(r.rank)} place{r.tied ? ' (tie)' : ''}
          </p>
          <p className="mt-1 font-semibold text-slate-900">
            #{r.number} {r.name}
          </p>
          {r.representing && <p className="text-xs text-slate-500">{r.representing}</p>}
          {showScores && r.finalScore !== undefined && <p className="mt-2 text-lg font-semibold text-brand-700 tabular-nums">{num(r.finalScore)}</p>}
        </div>
      ))}
    </div>
  );
}

export default function PublicResultsPage() {
  const { eventId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/public/events/${eventId}`)
      .then(({ data: d }) => setData(d))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [eventId]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState title="Results not available" description={error} action={<Link to="/" className="text-sm font-medium text-brand-600">Back to events</Link>} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const { event, sections, showScores } = data;
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="no-print mb-6 flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="size-4" /> All events
        </Link>
        <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <header className="mb-8">
        {event.coverImage && <img src={fileUrl(event.coverImage)} alt="" className="mb-6 h-48 w-full rounded-xl object-cover sm:h-64" />}
        <Badge tone="green" dot>
          Official results
        </Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{event.name}</h1>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500">
          <span>{eventTypeLabel(event.eventType)}</span>
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4" /> {formatDate(event.eventDate, { dateStyle: 'long' })}
          </span>
          {event.venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" /> {event.venue}
            </span>
          )}
        </div>
        {event.description && <p className="mt-3 max-w-3xl text-sm text-slate-600">{event.description}</p>}
      </header>

      <div className="space-y-10">
        {sections.map((s) => (
          <section key={s._id}>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{s.title}</h2>
              <p className="text-xs text-slate-500">
                {s.method && `${s.method} · `}Published {formatDateTime(s.publishedAt)}
              </p>
            </div>
            <Podium rows={s.rows} showScores={showScores} />
            {s.awards?.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {s.awards.map((a) => (
                  <div key={a.name} className="rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-white p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-amber-700 uppercase">
                      <Award className="size-3.5" /> {a.name}
                      {a.tied && <span className="font-normal normal-case">(shared)</span>}
                    </p>
                    {a.winners.map((w) => (
                      <div key={w.number} className="mt-3 flex items-center gap-3">
                        <Avatar name={w.name} src={w.photo} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900">
                            #{w.number} {w.name}
                          </p>
                          {w.representing && <p className="text-xs text-slate-500">{w.representing}</p>}
                        </div>
                        {showScores && w.value !== undefined && <span className="font-semibold text-brand-700 tabular-nums">{num(w.value)}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-20 text-center">Rank</th>
                    <th className="w-16 text-center">No.</th>
                    <th>Contestant</th>
                    {showScores && <th className="text-right">Final score</th>}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={`${s._id}-${r.number}`}>
                      <td className="text-center font-semibold tabular-nums">
                        {r.rank}
                        {r.tied && <span className="ml-1 text-xs font-normal text-amber-600">tie</span>}
                      </td>
                      <td className="text-center text-slate-500 tabular-nums">{r.number}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={r.name} src={r.photo} size="sm" />
                          <div>
                            <p className="font-medium text-slate-800">{r.name}</p>
                            {r.representing && <p className="text-xs text-slate-500">{r.representing}</p>}
                          </div>
                        </div>
                      </td>
                      {showScores && <td className="text-right font-semibold tabular-nums">{num(r.finalScore)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
