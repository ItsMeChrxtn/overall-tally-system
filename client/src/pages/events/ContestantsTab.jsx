import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Camera, Pencil, Plus, Trash2, UserRound, Users } from 'lucide-react';
import api from '../../api/client';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Modal, SearchInput, Select, TableSkeleton, Textarea, Toggle } from '../../components/ui';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const STATUS_TONE = { active: 'green', withdrawn: 'gray', disqualified: 'red' };

function emptyForm(nextNumber) {
  return { number: nextNumber, name: '', isTeam: false, teamName: '', members: '', representing: '', description: '', status: 'active', categories: [] };
}

function validate(f) {
  const e = {};
  const n = Number(f.number);
  if (!Number.isInteger(n) || n < 1) e.number = 'Use a whole number from 1.';
  if (!f.name.trim()) e.name = 'Name is required.';
  return e;
}

export default function ContestantsTab() {
  const { event, can, reload } = useOutletContext();
  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const [photoTarget, setPhotoTarget] = useState(null);
  const editable = can.manage && event.status !== 'archived';

  const load = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([api.get(`/events/${event._id}/contestants`), api.get(`/events/${event._id}/categories`)]);
      setItems(c.data.items);
      setCategories(k.data.items);
    } catch (err) {
      setItems([]);
      showError(err);
    }
  }, [event._id]);
  useEffect(() => {
    load();
  }, [load]);
  useEventSocket(event._id, { 'contestants:updated': load });

  const filtered = useMemo(
    () =>
      (items || []).filter(
        (c) =>
          (!q || `${c.number} ${c.name} ${c.representing || ''} ${c.teamName || ''}`.toLowerCase().includes(q.toLowerCase())) &&
          (!catFilter || c.categories.some((k) => k._id === catFilter))
      ),
    [items, q, catFilter]
  );
  const lockedIds = new Set(categories.filter((c) => c.configLocked).map((c) => c._id));

  const openNew = () => {
    const next = (items || []).reduce((m, c) => Math.max(m, c.number), 0) + 1;
    setErrors({});
    setModal(emptyForm(next));
  };
  const openEdit = (c) => {
    setErrors({});
    setModal({ ...c, members: (c.members || []).join('\n'), teamName: c.teamName || '', representing: c.representing || '', description: c.description || '', categories: c.categories.map((k) => k._id) });
  };

  const save = async () => {
    const e = validate(modal);
    setErrors(e);
    if (Object.keys(e).length) return;
    const payload = {
      number: Number(modal.number),
      name: modal.name.trim(),
      isTeam: modal.isTeam,
      teamName: modal.isTeam ? modal.teamName.trim() || modal.name.trim() : undefined,
      members: modal.isTeam ? modal.members.split(/\n|,/).map((m) => m.trim()).filter(Boolean) : [],
      representing: modal.representing.trim(),
      description: modal.description.trim(),
      status: modal.status,
      categories: modal.categories,
    };
    setSaving(true);
    try {
      if (modal._id) await api.patch(`/contestants/${modal._id}`, payload);
      else await api.post(`/events/${event._id}/contestants`, payload);
      toast.success(modal._id ? 'Contestant updated' : 'Contestant added');
      setModal(null);
      load();
      reload();
    } catch (err) {
      showError(err, 'Could not save contestant');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    if (!(await confirmAction({ title: `Delete #${c.number} ${c.name}?`, text: 'Contestants with submitted scores cannot be deleted; set them to Withdrawn instead.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.delete(`/contestants/${c._id}`);
      toast.success('Contestant deleted');
      load();
      reload();
    } catch (err) {
      showError(err, 'Cannot delete contestant');
    }
  };

  const uploadPhoto = async (file) => {
    if (!file || !photoTarget) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api.post(`/contestants/${photoTarget}/photo`, fd);
      toast.success('Photo updated');
      load();
    } catch (err) {
      showError(err, 'Upload failed');
    } finally {
      setPhotoTarget(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader
        title="Contestants & teams"
        description="Contestant numbers are unique within the event. Assign categories here or from each category page."
        actions={
          editable && (
            <Button size="sm" icon={Plus} onClick={openNew}>
              Add contestant
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-3 border-b border-ink-100 px-5 py-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search number, name, team…" className="w-full sm:w-72" />
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="w-full sm:w-56">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
      {items === null ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState icon={UserRound} title={items.length ? 'No contestants match your filters' : 'No contestants yet'} description="Add individual contestants or teams." action={editable && !items.length && <Button icon={Plus} onClick={openNew}>Add contestant</Button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-16 text-center">No.</th>
                <th>Contestant</th>
                <th>Representing</th>
                <th>Categories</th>
                <th>Status</th>
                {editable && <th className="w-32" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c._id}>
                  <td className="text-center font-semibold tabular-nums">{c.number}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={c.name} src={c.photo} />
                      <div className="min-w-0">
                        <p className="font-medium text-ink-800">{c.name}</p>
                        {c.isTeam && (
                          <p className="flex items-center gap-1 text-xs text-ink-500">
                            <Users className="size-3" /> Team · {c.members?.length || 0} members
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="text-ink-600">{c.representing || '—'}</td>
                  <td>
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {c.categories.length ? c.categories.map((k) => <Badge key={k._id}>{k.name}</Badge>) : <span className="text-xs text-ink-400">None</span>}
                    </div>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[c.status]} dot>
                      {c.status}
                    </Badge>
                  </td>
                  {editable && (
                    <td>
                      <div className="flex justify-end">
                        <IconButton
                          icon={Camera}
                          label="Upload photo"
                          onClick={() => {
                            setPhotoTarget(c._id);
                            fileRef.current?.click();
                          }}
                        />
                        <IconButton icon={Pencil} label="Edit" onClick={() => openEdit(c)} />
                        <IconButton icon={Trash2} label="Delete" onClick={() => remove(c)} className="hover:text-red-600" />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?._id ? 'Edit contestant' : 'Add contestant'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {modal && (
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="No." required error={errors.number}>
              <Input type="number" min="1" value={modal.number} onChange={(e) => setModal({ ...modal, number: e.target.value })} invalid={!!errors.number} />
            </Field>
            <Field label={modal.isTeam ? 'Team / group name' : 'Full name'} required error={errors.name} className="sm:col-span-3">
              <Input value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} invalid={!!errors.name} />
            </Field>
            <div className="sm:col-span-4">
              <Toggle checked={modal.isTeam} onChange={(v) => setModal({ ...modal, isTeam: v })} label="Team-based entry" description="For groups, bands, dance crews and teams." />
            </div>
            {modal.isTeam && (
              <Field label="Members" hint="One per line" className="sm:col-span-4">
                <Textarea rows={3} value={modal.members} onChange={(e) => setModal({ ...modal, members: e.target.value })} />
              </Field>
            )}
            <Field label="Representing" hint="College, school, barangay, club…" className="sm:col-span-2">
              <Input value={modal.representing} onChange={(e) => setModal({ ...modal, representing: e.target.value })} />
            </Field>
            <Field label="Participation status" className="sm:col-span-2" hint={modal._id && modal.categories.some((id) => lockedIds.has(id)) ? 'Locked while a category is scoring.' : undefined}>
              <Select value={modal.status} onChange={(e) => setModal({ ...modal, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="withdrawn">Withdrawn</option>
                <option value="disqualified">Disqualified</option>
              </Select>
            </Field>
            <Field label="Profile / description" className="sm:col-span-4">
              <Textarea rows={2} value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} />
            </Field>
            <Field label="Categories" className="sm:col-span-4" hint={!event.settings.allowMultiCategoryContestants ? 'This event allows only one category per contestant.' : 'Locked categories cannot be changed until their configuration is reopened.'}>
              <div className="grid gap-2 sm:grid-cols-2">
                {categories.map((k) => {
                  const checked = modal.categories.includes(k._id);
                  return (
                    <label key={k._id} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={k.configLocked}
                        onChange={(e) => {
                          const next = e.target.checked ? (event.settings.allowMultiCategoryContestants ? [...modal.categories, k._id] : [k._id]) : modal.categories.filter((x) => x !== k._id);
                          setModal({ ...modal, categories: next });
                        }}
                        className="rounded border-ink-300"
                      />
                      {k.name}
                      {k.configLocked && <span className="ml-auto text-[11px] text-ink-400">locked</span>}
                    </label>
                  );
                })}
                {!categories.length && <p className="text-sm text-ink-500">Create categories first.</p>}
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
