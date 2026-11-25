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
    <div className="w-14 shrink-0 rounded-lg bg-brand-50 py-2 text-center leading-none">
      <p className="text-[11px] font-semibold text-brand-600 uppercase">{d.toLocaleDateString('en-PH', { month: 'short' })}</p>
      <p className="mt-1 text-xl font-semibold text-navy-900">{d.getDate()}</p>
      <p className="mt-1 text-[11px] text-ink-400">{d.getFullYear()}</p>
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
      <section className="px-3 pt-3 sm:px-4">
        <div className="relative isolate mx-auto max-w-[1400px] overflow-hidden rounded-xl bg-navy-900 bg-[url('/nu-moa.jpg')] bg-cover bg-[50%_35%]">
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#0f1540f2_0%,#0f1540cc_50%,#0f154066_100%)]" />
          <div className="mx-auto max-w-5xl px-6 py-10 sm:py-12">
            <p className="text-xs font-medium text-gold-400">{settings?.organizationName || 'National University · Mall of Asia'}</p>
            <h1 className="mt-2 text-2xl font-semibold text-white sm:text-[28px]">Competition results</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#d6daef]">Results are posted after the score sheets are verified and approved by the organizers.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold text-ink-900">
            Released results {events?.length ? <span className="ml-1 text-sm font-normal text-ink-400">({events.length})</span> : null}
          </h2>
          <SearchInput value={q} onChange={setQ} placeholder="Event or venue" className="w-full sm:w-64" />
        </div>
        {error && (
          <Alert tone="amber" className="mb-6">
            {error}
          </Alert>
        )}
        {events === null ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-white">
            <EmptyState icon={Trophy} title={q ? 'Nothing matches that search' : 'No results have been released yet'} description={q ? undefined : 'Check back after the awarding ceremony.'} />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((e) => (
              <li key={e._id}>
                <Link to={`/results/${e._id}`} className="group flex items-center gap-4 rounded-xl border border-ink-200 bg-white px-4 py-3.5 transition-colors hover:border-brand-300">
                  <DateBlock date={e.eventDate} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink-500">{eventTypeLabel(e.eventType)}</p>
                    <h3 className="mt-0.5 text-[15px] font-semibold text-ink-900 group-hover:text-brand-700">{e.name}</h3>
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
