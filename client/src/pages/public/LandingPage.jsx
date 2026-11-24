import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, MapPin, Trophy } from 'lucide-react';
import api, { apiErrorMessage, fileUrl } from '../../api/client';
import { Alert, Badge, EmptyState, SearchInput, Skeleton } from '../../components/ui';
import { eventTypeLabel, formatDate } from '../../lib/format';

export default function LandingPage() {
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
      <section className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <Badge tone="brand">Official results</Badge>
          <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Competition results, verified and approved.</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600">Browse winners and rankings released by the organizers. Results appear here only after tabulation has been verified and formally approved.</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Published events</h2>
          <SearchInput value={q} onChange={setQ} placeholder="Search events or venues" className="w-full sm:w-72" />
        </div>
        {error && <Alert tone="amber" className="mb-6">{error}</Alert>}
        {events === null ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Trophy} title="No published results yet" description="Check back after the organizers release the official results." />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <Link key={e._id} to={`/results/${e._id}`} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                <div className="relative h-36 bg-gradient-to-br from-slate-800 to-brand-800">
                  {e.coverImage && <img src={fileUrl(e.coverImage)} alt="" className="absolute inset-0 size-full object-cover" />}
                  <div className="absolute bottom-3 left-3">
                    <Badge tone="gray" className="bg-white/90">
                      {eventTypeLabel(e.eventType)}
                    </Badge>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{e.name}</h3>
                  <div className="mt-2 space-y-1 text-sm text-slate-500">
                    <p className="flex items-center gap-2">
                      <CalendarDays className="size-4" /> {formatDate(e.eventDate, { dateStyle: 'long' })}
                    </p>
                    {e.venue && (
                      <p className="flex items-center gap-2">
                        <MapPin className="size-4" /> {e.venue}
                      </p>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm">
                    <span className="text-slate-500">
                      {e.publishedResults} result{e.publishedResults === 1 ? '' : 's'} released
                    </span>
                    <span className="inline-flex items-center font-medium text-brand-600">
                      View <ChevronRight className="size-4" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
