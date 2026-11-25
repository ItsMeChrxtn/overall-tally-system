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
    <div className="w-16 shrink-0 rounded-xl bg-brand-50 py-2.5 text-center leading-none">
      <p className="text-[11px] font-semibold text-brand-600 uppercase">{d.toLocaleDateString('en-PH', { month: 'short' })}</p>
      <p className="mt-1 font-display text-[26px] font-semibold text-navy-900">{d.getDate()}</p>
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
        <div className="relative isolate mx-auto max-w-[1400px] overflow-hidden rounded-[24px] bg-navy-900 bg-[url('/nu-moa.jpg')] bg-cover bg-[50%_35%]">
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#0f1540_0%,#0f1540e6_45%,#0f154066_100%)]" />
          <div className="nu-rise mx-auto max-w-5xl px-6 py-14 sm:py-20">
            <span className="inline-flex rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-ink-900">{settings?.organizationName || 'National University · Mall of Asia'}</span>
            <h1 className="mt-5 max-w-3xl text-[34px] leading-[1.1] font-bold text-white sm:text-5xl">
              Official <span className="text-gold-400">competition results</span>
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#d6daef]">Winners and rankings are posted here only after every score sheet has been verified by the tabulators and approved by the organizers.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold text-ink-900">
            Released results {events?.length ? <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-sm text-brand-700">{events.length}</span> : null}
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
          <ul className="nu-rise space-y-3">
            {filtered.map((e) => (
              <li key={e._id}>
                <Link to={`/results/${e._id}`} className="group flex items-center gap-5 rounded-xl border border-ink-200 bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
                  <DateBlock date={e.eventDate} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-gold-700">{eventTypeLabel(e.eventType)}</p>
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
