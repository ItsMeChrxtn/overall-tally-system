import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, CalendarPlus, Gavel, Layers, MapPin, UserRound } from 'lucide-react';
import api, { fileUrl } from '../../api/client';
import { useAuth, isAdmin } from '../../auth/AuthContext';
import { Button, Card, EmptyState, Modal, PageHeader, ProgressBar, SearchInput, Select, Skeleton } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { EVENT_STATUSES, EVENT_TYPES, eventTypeLabel, formatDate, titleCase } from '../../lib/format';
import { showError, toast } from '../../lib/alerts';
import EventForm, { emptyEvent, formToPayload, validateEvent } from './EventForm';

export default function EventsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyEvent());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setItems(null);
    api
      .get('/events', { params: { status: status || undefined, type: type || undefined } })
      .then(({ data }) => setItems(data.items))
      .catch((err) => {
        setItems([]);
        showError(err);
      });
  }, [status, type]);
  useEffect(load, [load]);

  const filtered = useMemo(() => (items || []).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase())), [items, q]);

  const create = async () => {
    const errs = validateEvent(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      const payload = formToPayload(form);
      if (user.role !== 'super_admin') delete payload.adminIds;
      const { data } = await api.post('/events', payload);
      toast.success('Event created');
      setOpen(false);
      navigate(`/app/events/${data.event._id}/categories`);
    } catch (err) {
      showError(err, 'Could not create event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={user.role === 'tabulator' ? 'Assigned events' : 'Events'}
        description="Each event keeps its own categories, contestants, judges, criteria and results."
        actions={
          isAdmin(user) && (
            <Button
              icon={CalendarPlus}
              onClick={() => {
                setForm(emptyEvent());
                setErrors({});
                setOpen(true);
              }}
            >
              New event
            </Button>
          )
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search events" className="w-full sm:w-72" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-48">
          <option value="">All except archived</option>
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-full sm:w-52">
          <option value="">All event types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {items === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-60 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="No events found"
            description={isAdmin(user) ? 'Create your first event to start configuring categories and criteria.' : 'You have not been assigned to any events yet.'}
            action={isAdmin(user) && <Button icon={CalendarPlus} onClick={() => setOpen(true)}>New event</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <Link key={e._id} to={`/app/events/${e._id}${user.role === 'tabulator' ? '/tally' : ''}`} className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md">
              <div className="relative h-24 bg-gradient-to-br from-slate-800 to-brand-800">
                {e.coverImage && <img src={fileUrl(e.coverImage)} alt="" className="absolute inset-0 size-full object-cover opacity-80" />}
                <div className="absolute top-3 right-3">
                  <StatusBadge status={e.status} />
                </div>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <p className="text-xs font-medium text-brand-600">{eventTypeLabel(e.eventType)}</p>
                <h3 className="mt-0.5 font-semibold text-slate-900 group-hover:text-brand-700">{e.name}</h3>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" /> {formatDate(e.eventDate, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  {e.venue && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="size-3.5" /> {e.venue}
                    </p>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center text-xs text-slate-500">
                  <span className="flex flex-col items-center gap-0.5">
                    <Layers className="size-3.5" /> <span className="font-semibold text-slate-800">{e.counts.categories}</span> categories
                  </span>
                  <span className="flex flex-col items-center gap-0.5">
                    <UserRound className="size-3.5" /> <span className="font-semibold text-slate-800">{e.counts.contestants}</span> contestants
                  </span>
                  <span className="flex flex-col items-center gap-0.5">
                    <Gavel className="size-3.5" /> <span className="font-semibold text-slate-800">{e.counts.judges}</span> judges
                  </span>
                </div>
                {e.counts.sheets > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                      <span>Score sheets submitted</span>
                      <span className="tabular-nums">
                        {e.counts.submittedSheets}/{e.counts.sheets}
                      </span>
                    </div>
                    <ProgressBar value={e.counts.submittedSheets} max={e.counts.sheets} />
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create event"
        description="You can add categories, contestants, judges and criteria after creating the event."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving}>
              Create event
            </Button>
          </>
        }
      >
        <EventForm value={form} onChange={setForm} errors={errors} showStatus showAdmins={user.role === 'super_admin'} />
      </Modal>
    </div>
  );
}
