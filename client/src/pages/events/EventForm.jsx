import { useEffect, useState } from 'react';
import api from '../../api/client';
import { Field, Input, Select, Textarea } from '../../components/ui';
import { EVENT_TYPES, toDateInput } from '../../lib/format';

export function emptyEvent() {
  return { name: '', description: '', eventType: 'pageant', venue: '', organizer: '', eventDate: '', startDate: '', endDate: '', status: 'draft', adminIds: [] };
}

export function eventToForm(e) {
  return {
    name: e.name || '',
    description: e.description || '',
    eventType: e.eventType || 'other',
    venue: e.venue || '',
    organizer: e.organizer || '',
    eventDate: toDateInput(e.eventDate),
    startDate: toDateInput(e.startDate),
    endDate: toDateInput(e.endDate),
  };
}

export function validateEvent(f) {
  const errors = {};
  if (!f.name || f.name.trim().length < 3) errors.name = 'Event name must have at least 3 characters.';
  if (f.startDate && f.endDate && new Date(f.endDate) < new Date(f.startDate)) errors.endDate = 'End must be after the start.';
  return errors;
}

export function formToPayload(f) {
  const out = { ...f };
  for (const k of ['eventDate', 'startDate', 'endDate']) out[k] = f[k] ? new Date(f[k]).toISOString() : null;
  return out;
}

/** Shared event fields (create modal + overview tab). */
export default function EventForm({ value, onChange, errors = {}, showStatus = false, showAdmins = false }) {
  const [admins, setAdmins] = useState([]);
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });

  useEffect(() => {
    if (!showAdmins) return;
    api.get('/users', { params: { role: 'event_admin', status: 'active', limit: 200 } }).then(({ data }) => setAdmins(data.items)).catch(() => {});
  }, [showAdmins]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Event name" required error={errors.name} className="sm:col-span-2">
        <Input value={value.name} onChange={set('name')} placeholder="e.g. Mr. & Ms. University 2026" invalid={!!errors.name} />
      </Field>
      <Field label="Event type" required>
        <Select value={value.eventType} onChange={set('eventType')}>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {showStatus ? (
        <Field label="Initial status">
          <Select value={value.status} onChange={set('status')}>
            <option value="draft">Draft</option>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
          </Select>
        </Field>
      ) : (
        <Field label="Organizer">
          <Input value={value.organizer} onChange={set('organizer')} placeholder="Organizing office or group" />
        </Field>
      )}
      <Field label="Venue" className={showStatus ? '' : 'sm:col-span-2'}>
        <Input value={value.venue} onChange={set('venue')} placeholder="e.g. University Gymnasium" />
      </Field>
      {showStatus && (
        <Field label="Organizer">
          <Input value={value.organizer} onChange={set('organizer')} />
        </Field>
      )}
      <Field label="Event date & time">
        <Input type="datetime-local" value={value.eventDate} onChange={set('eventDate')} />
      </Field>
      <div className="hidden sm:block" />
      <Field label="Start">
        <Input type="datetime-local" value={value.startDate} onChange={set('startDate')} />
      </Field>
      <Field label="End" error={errors.endDate}>
        <Input type="datetime-local" value={value.endDate} onChange={set('endDate')} invalid={!!errors.endDate} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea value={value.description} onChange={set('description')} rows={3} />
      </Field>
      {showAdmins && (
        <Field label="Assigned Event Admins" hint="Hold Ctrl / Cmd to select several." className="sm:col-span-2">
          <select
            multiple
            value={value.adminIds}
            onChange={(e) => onChange({ ...value, adminIds: [...e.target.selectedOptions].map((o) => o.value) })}
            className="block h-28 w-full rounded-lg border border-ink-300 px-2 py-1 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          >
            {admins.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name} — {a.email}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}
