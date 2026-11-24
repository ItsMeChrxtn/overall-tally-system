import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Modal, ProgressBar, Select, TableSkeleton } from '../../components/ui';
import { ROLE_LABELS, formatDateTime } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const SECTIONS = [
  { role: 'judge', title: 'Judges', description: 'Judges only see and score the categories assigned to them.' },
  { role: 'tabulator', title: 'Tabulators', description: 'Consolidate scores, verify the tally and submit results for approval.' },
  { role: 'event_admin', title: 'Event Admins', description: 'Configure the event and approve results. Assigned by a Super Admin.' },
];

export default function StaffTab() {
  const { event, can, reload } = useOutletContext();
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [progress, setProgress] = useState({});
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);
  const editable = can.manage && event.status !== 'archived';

  const load = useCallback(async () => {
    try {
      const [a, c] = await Promise.all([api.get(`/events/${event._id}/assignments`), api.get(`/events/${event._id}/categories`)]);
      setItems(a.data.items);
      setProgress(a.data.progress);
      setCategories(c.data.items);
    } catch (err) {
      setItems([]);
      showError(err);
    }
  }, [event._id]);
  useEffect(() => {
    load();
  }, [load]);
  useEventSocket(event._id, { 'assignments:updated': load, 'sheet:submitted': load });

  const openAdd = async (role) => {
    try {
      const { data } = await api.get('/users', { params: { role, status: 'active', limit: 200 } });
      const taken = new Set((items || []).filter((a) => a.role === role).map((a) => a.user._id));
      setCandidates(data.items.filter((u) => !taken.has(u._id)));
      setModal({ mode: 'add', role, user: '', categories: role === 'judge' ? categories.filter((c) => !c.configLocked).map((c) => c._id) : [], order: '' });
    } catch (err) {
      showError(err);
    }
  };

  const openQuick = () => setModal({ mode: 'quick', role: 'judge', name: '', title: '', categories: categories.filter((c) => !c.configLocked).map((c) => c._id), order: '' });

  const save = async () => {
    setSaving(true);
    try {
      if (modal.mode === 'quick') {
        if (modal.name.trim().length < 2) throw { response: { data: { message: "Enter the judge's name." } } };
        await api.post(`/events/${event._id}/encode-judges`, { name: modal.name.trim(), ...(modal.title.trim() ? { title: modal.title.trim() } : {}), categories: modal.categories, ...(modal.order ? { order: Number(modal.order) } : {}) });
        toast.success(`${modal.name.trim()} added as judge`);
      } else if (modal.mode === 'add') {
        if (!modal.user) throw { response: { data: { message: 'Choose a user account.' } } };
        await api.post(`/events/${event._id}/assignments`, { user: modal.user, role: modal.role, categories: modal.categories, ...(modal.order ? { order: Number(modal.order) } : {}) });
        toast.success(`${ROLE_LABELS[modal.role]} assigned`);
      } else {
        await api.patch(`/assignments/${modal._id}`, { categories: modal.categories, order: Number(modal.order) || 0 });
        toast.success('Assignment updated');
      }
      setModal(null);
      load();
      reload();
    } catch (err) {
      showError(err, 'Could not save assignment');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a) => {
    if (!(await confirmAction({ title: `Remove ${a.user.name} from this event?`, text: 'Judges who already submitted scores cannot be removed.', confirmText: 'Remove', danger: true }))) return;
    try {
      await api.delete(`/assignments/${a._id}`);
      toast.success('Removed from event');
      load();
      reload();
    } catch (err) {
      showError(err, 'Cannot remove');
    }
  };

  const grouped = useMemo(() => Object.fromEntries(SECTIONS.map((s) => [s.role, (items || []).filter((a) => a.role === s.role)])), [items]);

  if (items === null) return <Card><TableSkeleton /></Card>;

  return (
    <div className="space-y-6">
      {SECTIONS.map((s) => {
        const canAdd = editable && (s.role !== 'event_admin' || user.role === 'super_admin');
        const list = grouped[s.role];
        return (
          <Card key={s.role}>
            <CardHeader
              title={`${s.title} (${list.length})`}
              description={s.description}
              actions={
                canAdd && (
                  <>
                    {user.role !== 'tabulator' && s.role !== 'event_admin' && (
                      <Link to="/app/users" className="text-xs font-medium text-slate-500 hover:text-slate-800">
                        Create account
                      </Link>
                    )}
                    <Button size="sm" variant={s.role === 'judge' ? 'secondary' : 'primary'} icon={UserPlus} onClick={() => openAdd(s.role)}>
                      Assign {ROLE_LABELS[s.role].toLowerCase()}
                    </Button>
                    {s.role === 'judge' && (
                      <Button size="sm" icon={Plus} onClick={openQuick}>
                        Add judge (name only)
                      </Button>
                    )}
                  </>
                )
              }
            />
            {list.length === 0 ? (
              <EmptyState title={`No ${s.title.toLowerCase()} assigned`} className="py-8" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      {s.role === 'judge' && <th className="w-20">Seat</th>}
                      <th>Name</th>
                      {s.role === 'judge' && <th>Categories</th>}
                      {s.role === 'judge' && <th className="w-48">Submitted</th>}
                      <th>Account</th>
                      <th>Last sign-in</th>
                      {editable && <th className="w-24" />}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => {
                      const p = progress[a._id];
                      return (
                        <tr key={a._id}>
                          {s.role === 'judge' && <td className="font-medium text-slate-600">Judge {a.order}</td>}
                          <td>
                            <div className="flex items-center gap-3">
                              <Avatar name={a.user.name} size="sm" />
                              <div>
                                <p className="font-medium text-slate-800">{a.user.name}</p>
                                <p className="text-xs text-slate-500">{[a.user.title, a.user.loginEnabled === false ? 'Scores encoded by admin · no login' : a.user.email].filter(Boolean).join(' · ')}</p>
                              </div>
                            </div>
                          </td>
                          {s.role === 'judge' && (
                            <td>
                              <div className="flex max-w-xs flex-wrap gap-1">{a.categories.length ? a.categories.map((c) => <Badge key={c._id}>{c.name}</Badge>) : <span className="text-xs text-slate-400">None</span>}</div>
                            </td>
                          )}
                          {s.role === 'judge' && (
                            <td>
                              {p?.expected ? (
                                <div className="flex items-center gap-2">
                                  <ProgressBar value={p.submitted} max={p.expected} className="flex-1" />
                                  <span className="text-xs text-slate-500 tabular-nums">
                                    {p.submitted}/{p.expected}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                          )}
                          <td>
                            <Badge tone={a.user.status === 'active' ? 'green' : 'red'} dot>
                              {a.user.status}
                            </Badge>
                          </td>
                          <td className="text-xs text-slate-500">{a.user.loginEnabled === false ? <Badge tone="gray">Encoded</Badge> : formatDateTime(a.user.lastLoginAt)}</td>
                          {editable && (
                            <td>
                              <div className="flex justify-end">
                                {s.role === 'judge' && <IconButton icon={Pencil} label="Edit assignment" onClick={() => setModal({ mode: 'edit', _id: a._id, role: a.role, name: a.user.name, categories: a.categories.map((c) => c._id), order: a.order })} />}
                                {(s.role !== 'event_admin' || user.role === 'super_admin') && <IconButton icon={Trash2} label="Remove" onClick={() => remove(a)} className="hover:text-red-600" />}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'quick' ? 'Add judge (name only)' : modal?.mode === 'add' ? `Assign ${ROLE_LABELS[modal?.role]?.toLowerCase()}` : `Edit ${modal?.name}`}
        description={modal?.mode === 'quick' ? 'This judge will not sign in. You will type their scores from the paper sheet in the Encode Scores tab.' : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button icon={Plus} onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {modal && (
          <div className="space-y-4">
            {modal.mode === 'quick' && (
              <>
                <Field label="Judge's name" required>
                  <Input autoFocus value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} placeholder="e.g. Maria Santos" />
                </Field>
                <Field label="Title / position" hint="Optional. Shown on reports.">
                  <Input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Music Instructor" />
                </Field>
              </>
            )}
            {modal.mode === 'add' && (
              <Field label="Account" required hint={candidates.length ? undefined : `No unassigned active ${ROLE_LABELS[modal.role].toLowerCase()} accounts. Create one under Users first.`}>
                <Select value={modal.user} onChange={(e) => setModal({ ...modal, user: e.target.value })}>
                  <option value="">Choose…</option>
                  {candidates.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.name} — {u.email}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {modal.role === 'judge' && (
              <>
                <Field label="Seat number" hint="Determines column order on tally sheets (Judge 1, Judge 2…). Leave blank for the next seat.">
                  <Input type="number" min="1" value={modal.order} onChange={(e) => setModal({ ...modal, order: e.target.value })} className="w-32" />
                </Field>
                <Field label="Categories to judge" hint="Locked categories must be reopened before their panel changes.">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {categories.map((c) => (
                      <label key={c._id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={c.configLocked}
                          checked={modal.categories.includes(c._id)}
                          onChange={(e) => setModal({ ...modal, categories: e.target.checked ? [...modal.categories, c._id] : modal.categories.filter((x) => x !== c._id) })}
                          className="rounded border-slate-300"
                        />
                        {c.name}
                        {c.configLocked && <span className="ml-auto text-[11px] text-slate-400">locked</span>}
                      </label>
                    ))}
                    {!categories.length && <p className="text-sm text-slate-500">No categories yet.</p>}
                  </div>
                </Field>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
