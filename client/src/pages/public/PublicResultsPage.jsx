import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Award, CalendarDays, MapPin, Printer } from 'lucide-react';
import api, { apiErrorMessage, fileUrl } from '../../api/client';
import { Avatar, Button, EmptyState, Skeleton, cx } from '../../components/ui';
import { eventTypeLabel, formatDate, formatDateTime, num, ordinal } from '../../lib/format';

const PLACE_STYLE = {
  1: "border-t-gold-500 text-gold-700",
  2: "border-t-ink-400 text-ink-600",
  3: "border-t-orange-700/60 text-orange-900",
};

function Podium({ rows, showScores, count = 3 }) {
  const top = rows.filter((r) => r.rank <= count);
  if (!top.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {top.map((r) => (
        <div key={r.number} className={cx("rounded-lg border border-t-[3px] border-ink-200 bg-white p-4", PLACE_STYLE[r.rank] || "border-t-brand-500 text-brand-700")}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-3xl leading-none font-semibold">
              {ordinal(r.rank)}
              {r.tied && <span className="ml-1.5 align-middle font-sans text-xs font-medium text-ink-500">tie</span>}
            </p>
            <Avatar name={r.name} src={r.photo} size="lg" />
          </div>
          <p className="mt-4 font-semibold text-ink-900">
            <span className="mr-1.5 font-mono text-sm font-normal text-ink-400">#{r.number}</span>
            {r.name}
          </p>
          {r.representing && <p className="text-[13px] text-ink-500">{r.representing}</p>}
          {showScores && r.finalScore !== undefined && <p className="mt-3 border-t border-dashed border-ink-200 pt-2 text-right text-lg text-ink-900 tabular-nums">{num(r.finalScore)}</p>}
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
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900">
          <ArrowLeft className="size-4" /> All events
        </Link>
        <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <header className="mb-10 border-b-2 border-double border-ink-300 pb-6">
        {event.coverImage && <img src={fileUrl(event.coverImage)} alt="" className="mb-6 h-48 w-full rounded-lg object-cover sm:h-64" />}
        <p className="label-caps text-brand-700">Official results · {eventTypeLabel(event.eventType)}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-ink-900 sm:text-[40px]">{event.name}</h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-500">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4" /> {formatDate(event.eventDate, { dateStyle: 'long' })}
          </span>
          {event.venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" /> {event.venue}
            </span>
          )}
        </div>
        {event.description && <p className="mt-3 max-w-3xl text-sm text-ink-600">{event.description}</p>}
      </header>

      <div className="space-y-10">
        {sections.map((s) => (
          <section key={s._id}>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-2xl font-semibold text-ink-900">{s.title}</h2>
              <p className="font-mono text-[11px] text-ink-500">
                {s.method && `${s.method} · `}Published {formatDateTime(s.publishedAt)}
              </p>
            </div>
            <Podium rows={s.rows} showScores={showScores} count={s.awardees} />
            {s.awards?.length > 0 && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {s.awards.map((a) => (
                  <div key={a.name} className="rounded-lg border border-ink-200 border-t-2 border-t-gold-500 bg-white p-4">
                    <p className="flex items-center gap-1.5 font-display text-lg font-semibold text-ink-900">
                      <Award className="size-4 text-gold-500" strokeWidth={1.75} /> {a.name}
                      {a.tied && <span className="font-sans text-xs font-normal text-ink-500">(shared)</span>}
                    </p>
                    {a.winners.map((w) => (
                      <div key={w.number} className="mt-3 flex items-center gap-3">
                        <Avatar name={w.name} src={w.photo} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-ink-900">
                            #{w.number} {w.name}
                          </p>
                          {w.representing && <p className="text-xs text-ink-500">{w.representing}</p>}
                        </div>
                        {showScores && w.value !== undefined && <span className="font-semibold text-brand-700 tabular-nums">{num(w.value)}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
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
                        {r.tied && <span className="ml-1 font-sans text-xs font-normal text-gold-700">tie</span>}
                      </td>
                      <td className="text-center text-ink-500 tabular-nums">{r.number}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={r.name} src={r.photo} size="sm" />
                          <div>
                            <p className="font-medium text-ink-800">{r.name}</p>
                            {r.representing && <p className="text-xs text-ink-500">{r.representing}</p>}
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
