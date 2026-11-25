import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Archive, ArchiveRestore, ImageUp, Save, Trash2 } from 'lucide-react';
import api, { fileUrl } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, CardHeader, Field, Input, Select, Toggle } from '../../components/ui';
import { EVENT_STATUSES, eventTypeLabel, formatDate, formatDateTime, titleCase } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import EventForm, { eventToForm, formToPayload, validateEvent } from './EventForm';

function ReadOnly({ event }) {
  const rows = [
    ['Type', eventTypeLabel(event.eventType)],
    ['Status', titleCase(event.status)],
    ['Event date', formatDate(event.eventDate, { dateStyle: 'full', timeStyle: 'short' })],
    ['Venue', event.venue || '—'],
    ['Organizer', event.organizer || '—'],
    ['Created by', event.createdBy?.name || '—'],
  ];
  return (
    <Card>
      <CardHeader title="Event information" />
      <dl className="divide-y divide-ink-100">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-4 px-5 py-3 text-sm">
            <dt className="text-ink-500">{k}</dt>
            <dd className="col-span-2 text-ink-800">{v}</dd>
          </div>
        ))}
      </dl>
      {event.description && <p className="border-t border-ink-100 px-5 py-4 text-sm text-ink-600">{event.description}</p>}
    </Card>
  );
}

export default function OverviewTab() {
  const { event, can, reload } = useOutletContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(eventToForm(event));
  const [settings, setSettings] = useState(event.settings);
  const [overall, setOverall] = useState(event.overall);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const archived = event.status === 'archived';
  const editable = can.manage && !archived;

  useEffect(() => {
    setForm(eventToForm(event));
    setSettings(event.settings);
    setOverall(event.overall);
  }, [event]);

  const save = async () => {
    const errs = validateEvent(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    try {
      await api.patch(`/events/${event._id}`, { ...formToPayload(form), settings, overall });
      toast.success('Event saved');
      reload();
    } catch (err) {
      showError(err, 'Could not save event');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    if (status === event.status) return;
    if (!(await confirmAction({ title: `Mark event as "${titleCase(status)}"?`, confirmText: 'Change status' }))) return;
    try {
      await api.patch(`/events/${event._id}/status`, { status });
      toast.success('Status updated');
      reload();
    } catch (err) {
      showError(err);
    }
  };

  const uploadCover = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api.post(`/events/${event._id}/cover`, fd);
      toast.success('Cover image updated');
      reload();
    } catch (err) {
      showError(err, 'Upload failed');
    }
  };

  const archive = async () => {
    if (!(await confirmAction({ title: 'Archive this event?', text: 'Archived events become read-only. Results and history remain available.', confirmText: 'Archive', danger: true }))) return;
    try {
      await api.post(`/events/${event._id}/archive`);
      toast.success('Event archived');
      reload();
    } catch (err) {
      showError(err);
    }
  };
  const restore = async () => {
    try {
      await api.post(`/events/${event._id}/restore`);
      toast.success('Event restored');
      reload();
    } catch (err) {
      showError(err);
    }
  };
  const remove = async () => {
    if (!(await confirmAction({ title: 'Delete this event permanently?', text: 'This removes all categories, contestants, criteria and drafts. Events with submitted scores cannot be deleted — archive them instead.', confirmText: 'Delete event', danger: true }))) return;
    try {
      await api.delete(`/events/${event._id}`);
      toast.success('Event deleted');
      navigate('/app/events');
    } catch (err) {
      showError(err, 'Cannot delete event');
    }
  };

  if (!can.manage) return <ReadOnly event={event} />;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {archived && <Alert tone="gray" title="This event is archived and read-only." />}
        <Card>
          <CardHeader title="Event details" description="Basic information shown on reports and the public results page." />
          <fieldset disabled={!editable} className="p-5">
            <EventForm value={form} onChange={setForm} errors={errors} />
          </fieldset>
        </Card>

        <Card>
          <CardHeader title="Event rules" description="These settings apply to every category in this event." />
          <div className="space-y-4 p-5">
            <Toggle disabled={!editable} checked={settings.allowMultiCategoryContestants} onChange={(v) => setSettings({ ...settings, allowMultiCategoryContestants: v })} label="Allow contestants in multiple categories" description="When off, each contestant may join only one category." />
            <Toggle disabled={!editable} checked={settings.judgesCanViewOwnSubmitted} onChange={(v) => setSettings({ ...settings, judgesCanViewOwnSubmitted: v })} label="Judges can view their own submitted scores" description="Judges never see other judges’ scores." />
            <Toggle disabled={!editable} checked={settings.allowIncompleteRanking} onChange={(v) => setSettings({ ...settings, allowIncompleteRanking: v })} label="Allow official rankings with incomplete score sheets" description="Not recommended. When off, results cannot be finalized until every sheet is in." />
            <Toggle disabled={!editable} checked={settings.publicShowScores} onChange={(v) => setSettings({ ...settings, publicShowScores: v })} label="Show final scores on the public results page" description="When off, only rankings are shown publicly." />
          </div>
        </Card>

        <Card>
          <CardHeader title="Overall tally" description="Combine several categories into one event-wide ranking (e.g. Overall Champion)." />
          <div className="space-y-4 p-5">
            <Toggle disabled={!editable} checked={overall.enabled} onChange={(v) => setOverall({ ...overall, enabled: v })} label="Enable overall tally" description="Choose which categories count and their weights on the Categories tab." />
            {overall.enabled && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Title">
                  <Input disabled={!editable} value={overall.title} onChange={(e) => setOverall({ ...overall, title: e.target.value })} />
                </Field>
                <Field label="Method" hint={overall.method === 'weighted' ? 'Σ normalized category score × weight' : 'Lowest sum of category ranks wins'}>
                  <Select disabled={!editable} value={overall.method} onChange={(e) => setOverall({ ...overall, method: e.target.value })}>
                    <option value="weighted">Weighted category scores</option>
                    <option value="rank_sum">Sum of category ranks</option>
                  </Select>
                </Field>
                <Field label="Decimal places">
                  <Select disabled={!editable} value={overall.decimalPlaces} onChange={(e) => setOverall({ ...overall, decimalPlaces: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
        </Card>

        {editable && (
          <div className="flex justify-end">
            <Button icon={Save} onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Status" />
          <div className="space-y-3 p-5">
            <Field label="Event status" hint="Scoring, approval and publication statuses are also updated automatically by the workflow.">
              <Select disabled={!editable} value={event.status} onChange={(e) => changeStatus(e.target.value)}>
                {EVENT_STATUSES.filter((s) => s !== 'archived' || archived).map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-ink-500">Last updated {formatDateTime(event.updatedAt)}</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Cover image" />
          <div className="p-5">
            <div className="mb-3 flex h-36 items-center justify-center overflow-hidden rounded-lg bg-ink-100">
              {event.coverImage ? <img src={fileUrl(event.coverImage)} alt="" className="size-full object-cover" /> : <span className="text-xs text-ink-400">No cover image</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
            <Button variant="secondary" size="sm" icon={ImageUp} disabled={!editable} onClick={() => fileRef.current?.click()}>
              Upload image
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Danger zone" />
          <div className="flex flex-wrap gap-2 p-5">
            {archived ? (
              user.role === 'super_admin' && (
                <Button variant="secondary" icon={ArchiveRestore} onClick={restore}>
                  Restore event
                </Button>
              )
            ) : (
              <Button variant="secondary" icon={Archive} onClick={archive}>
                Archive event
              </Button>
            )}
            {user.role === 'super_admin' && (
              <Button variant="danger" icon={Trash2} onClick={remove}>
                Delete event
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
