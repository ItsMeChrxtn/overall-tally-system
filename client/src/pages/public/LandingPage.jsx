import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ArrowUpRight, MapPin, Trophy } from 'lucide-react';
import api, { apiErrorMessage, fileUrl } from '../../api/client';
import { Alert, EmptyState, SearchInput, Skeleton } from '../../components/ui';
import { eventTypeLabel, formatDate } from '../../lib/format';

function DateBlock({ date }) {
  const d = date ? new Date(date) : null;
  if (!d || Number.isNaN(d.getTime())) return <div className="w-14 shrink-0" />;
  return (
    <div className="w-14 shrink-0 text-center leading-none">
      <p className="font-mono text-[11px] text-ink-500 uppercase">{d.toLocaleDateString('en-PH', { month: 'short' })}</p>
      <p className="mt-1 font-display text-[28px] font-semibold text-ink-900">{d.getDate()}</p>
      <p className="mt-1 font-mono text-[11px] text-ink-400">{d.getFullYear()}</p>
    </div>
  );
}

export default function LandingPage() {
  const { settings } = useOutletContext() || {};
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api
      .get('/public/events')
      .then(({ data }) => setEvents(data.items))
      .catch((err) => {
        setError(apiErrorMessage(err));
        setEvents([]);
      });
  }, []);

  const filtered = useMemo(() => (events || []).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()) || (e.venue || '').toLowerCase().includes(q.toLowerCase())), [events, q]);

  return (
    <div>
      <section className="border-b border-ink-200">
        <div className="mx-auto max-w-5xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
          <p className="label-caps text-brand-700">{settings?.organizationName || 'Results board'}</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl leading-[1.1] font-semibold text-ink-900 sm:text-5xl">Final rankings and winners, as certified by the board of judges.</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-600">Results are posted here only after every score sheet has been checked by the tabulators and signed off by the organizers.</p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-900">
            Released results {events?.length ? <span className="ml-1 font-mono font-normal text-ink-400">{events.length}</span> : null}
          </h2>
          <SearchInput value={q} onChange={setQ} placeholder="Event or venue" className="w-full sm:w-64" />
        </div>
        {error && (
          <Alert tone="amber" className="mb-6">
            {error}
          </Alert>
        )}
        {events === null ? (
          <div className="space-y-px">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-300">
            <EmptyState icon={Trophy} title={q ? 'Nothing matches that search' : 'No results have been released yet'} description={q ? undefined : 'Check back after the awarding ceremony.'} />
          </div>
        ) : (
          <ul className="divide-y divide-ink-200 border-y border-ink-200">
            {filtered.map((e) => (
              <li key={e._id}>
                <Link to={`/results/${e._id}`} className="group -mx-3 flex items-center gap-5 rounded-md px-3 py-5 transition-colors hover:bg-white">
                  <DateBlock date={e.eventDate} />
                  <div className="min-w-0 flex-1 border-l border-ink-200 pl-5">
                    <p className="text-xs text-ink-500">{eventTypeLabel(e.eventType)}</p>
                    <h3 className="mt-0.5 text-lg leading-snug font-semibold text-ink-900 group-hover:text-brand-700">{e.name}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-500">
                      {e.venue && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" strokeWidth={1.75} /> {e.venue}
                        </span>
                      )}
                      <span>
                        {e.publishedResults} {e.publishedResults === 1 ? 'category' : 'categories'} released
                      </span>
                      <span className="sm:hidden">{formatDate(e.eventDate, { dateStyle: 'medium' })}</span>
                    </p>
                  </div>
                  {e.coverImage && <img src={fileUrl(e.coverImage)} alt="" className="hidden h-16 w-24 shrink-0 rounded-md object-cover sm:block" />}
                  <ArrowUpRight className="size-5 shrink-0 text-ink-300 transition-colors group-hover:text-brand-700" strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
