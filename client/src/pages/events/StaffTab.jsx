import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Modal, ProgressBar, TableSkeleton, Toggle } from '../../components/ui';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { useEventSocket } from '../../lib/socket';

const fail = (message) => ({ response: { data: { message } } });
const hasLogin = (a) => a.user.loginEnabled !== false;

/**
 * Judges of the event. A judge with their own sign-in scores their assigned categories
 * themselves (Judge portal); a name-only judge's paper sheets are typed in the Encode Scores tab.
 */
export default function StaffTab() {
  const { event, can, reload } = useOutletContext();
  const [items, setItems] = useState(null);
  const [progress, setProgress] = useState({});
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null);
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

  const judges = useMemo(() => (items || []).filter((a) => a.role === 'judge'), [items]);

  const openAdd = () =>
    setModal({ mode: 'add', name: '', title: '', categories: categories.filter((c) => !c.configLocked).map((c) => c._id), order: '', withLogin: true, email: '', password: '' });
  const openLogin = (a) => setModal({ mode: 'login', _id: a._id, name: a.user.name, enabled: hasLogin(a), email: hasLogin(a) ? a.user.email : '', password: '' });

  const save = async () => {
    setSaving(true);
    try {
      if (modal.mode === 'add') {
        if (modal.name.trim().length < 2) throw fail("Enter the judge's name.");
        if (modal.withLogin && (!modal.email.trim() || !modal.password)) throw fail('Enter the email and password the judge will sign in with.');
        await api.post(`/events/${event._id}/encode-judges`, {
          name: modal.name.trim(),
          ...(modal.title.trim() ? { title: modal.title.trim() } : {}),
          categories: modal.categories,
          ...(modal.order ? { order: Number(modal.order) } : {}),
          ...(modal.withLogin ? { email: modal.email.trim(), password: modal.password } : {}),
        });
        toast.success(`${modal.name.trim()} added as judge`);
      } else if (modal.mode === 'login') {
        if (!modal.email.trim() || !modal.password) throw fail('Enter the email and a new password.');
        await api.put(`/assignments/${modal._id}/judge-login`, { email: modal.email.trim(), password: modal.password });
        toast.success(`Sign-in saved for ${modal.name}`);
      } else {
        await api.patch(`/assignments/${modal._id}`, { categories: modal.categories, order: Number(modal.order) || 0 });
        toast.success('Judge updated');
      }
      setModal(null);
      load();
      reload();
    } catch (err) {
      showError(err, 'Could not save judge');
    } finally {
      setSaving(false);
    }
  };

  const disableLogin = async () => {
    if (!(await confirmAction({ title: `Turn off ${modal.name}'s sign-in?`, text: 'They will be signed out and can no longer score. You will encode their scores in the Encode Scores tab instead.', confirmText: 'Turn off', danger: true }))) return;
    setSaving(true);
    try {
      await api.put(`/assignments/${modal._id}/judge-login`, { enabled: false });
      toast.success(`${modal.name} can no longer sign in`);
      setModal(null);
      load();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a) => {
    if (!(await confirmAction({ title: `Remove ${a.user.name} from this event?`, text: 'Judges who already have submitted scores cannot be removed.', confirmText: 'Remove', danger: true }))) return;
    try {
      await api.delete(`/assignments/${a._id}`);
      toast.success('Judge removed');
      load();
      reload();
    } catch (err) {
      showError(err, 'Cannot remove');
    }
  };

  if (items === null) return <Card><TableSkeleton /></Card>;

  const loginFields = (
    <>
      <Field label="Sign-in email" required hint="The judge signs in with this email at the login page.">
        <Input type="email" autoComplete="off" value={modal?.email || ''} onChange={(e) => setModal({ ...modal, email: e.target.value })} placeholder="e.g. judge1@school.edu.ph" />
      </Field>
      <Field label={modal?.mode === 'login' && modal.enabled ? 'New password' : 'Password'} required hint="At least 8 characters with letters and numbers. Give it to the judge privately.">
        <Input type="text" autoComplete="new-password" value={modal?.password || ''} onChange={(e) => setModal({ ...modal, password: e.target.value })} />
      </Field>
    </>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Judges (${judges.length})`}
          description="Judges with their own sign-in score only the categories assigned to them. Name-only judges' paper sheets are typed in the Encode Scores tab."
          actions={
            editable && (
              <Button size="sm" icon={Plus} onClick={openAdd}>
                Add judge
              </Button>
            )
          }
        />
        {judges.length === 0 ? (
          <EmptyState title="No judges yet" description="Add each judge, give them a sign-in, then choose the categories they score." className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-24">Seat</th>
                  <th>Name</th>
                  <th>Sign-in</th>
                  <th>Categories</th>
                  <th className="w-48">Scores submitted</th>
                  {editable && <th className="w-28" />}
                </tr>
              </thead>
              <tbody>
                {judges.map((a) => {
                  const p = progress[a._id];
                  return (
                    <tr key={a._id}>
                      <td className="font-medium text-ink-600">Judge {a.order}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={a.user.name} size="sm" />
                          <div>
                            <p className="font-medium text-ink-800">{a.user.name}</p>
                            {a.user.title && <p className="text-xs text-ink-500">{a.user.title}</p>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {hasLogin(a) ? (
                          <div>
                            <Badge tone="green" dot>Scores own sheets</Badge>
                            <p className="mt-1 text-xs text-ink-500">{a.user.email}</p>
                          </div>
                        ) : (
                          <Badge tone="gray">No sign-in · encoded by admin</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex max-w-xs flex-wrap gap-1">{a.categories.length ? a.categories.map((c) => <Badge key={c._id}>{c.name}</Badge>) : <span className="text-xs text-ink-400">None</span>}</div>
                      </td>
                      <td>
                        {p?.expected ? (
                          <div className="flex items-center gap-2">
                            <ProgressBar value={p.submitted} max={p.expected} className="flex-1" />
                            <span className="text-xs text-ink-500 tabular-nums">
                              {p.submitted}/{p.expected}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      {editable && (
                        <td>
                          <div className="flex justify-end">
                            <IconButton icon={KeyRound} label={hasLogin(a) ? 'Change sign-in' : 'Give sign-in'} onClick={() => openLogin(a)} />
                            <IconButton icon={Pencil} label="Edit judge" onClick={() => setModal({ mode: 'edit', _id: a._id, name: a.user.name, categories: a.categories.map((c) => c._id), order: a.order })} />
                            <IconButton icon={Trash2} label="Remove" onClick={() => remove(a)} className="hover:text-red-600" />
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

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'add' ? 'Add judge' : modal?.mode === 'login' ? `${modal.name}'s sign-in` : `Edit ${modal?.name}`}
        description={modal?.mode === 'login' ? 'The judge signs in with these details and can score only the categories assigned to them.' : undefined}
        footer={
          <>
            {modal?.mode === 'login' && modal.enabled && (
              <Button variant="secondary" onClick={disableLogin} disabled={saving} className="mr-auto text-red-600">
                Turn off sign-in
              </Button>
            )}
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button icon={modal?.mode === 'login' ? KeyRound : Plus} onClick={save} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        {modal?.mode === 'login' && (
          <div className="space-y-4">
            {modal.enabled && <Alert tone="blue">Saving sets a new password and signs the judge out of any open session.</Alert>}
            {loginFields}
          </div>
        )}
        {modal && modal.mode !== 'login' && (
          <div className="space-y-4">
            {modal.mode === 'add' && (
              <>
                <Field label="Judge's name" required>
                  <Input autoFocus value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} placeholder="e.g. Maria Santos" />
                </Field>
                <Field label="Title / position" hint="Optional. Shown on reports.">
                  <Input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Music Instructor" />
                </Field>
                <Toggle
                  checked={modal.withLogin}
                  onChange={(v) => setModal({ ...modal, withLogin: v })}
                  label="Judge signs in and scores their own sheets"
                  description={modal.withLogin ? 'The judge gets a separate account and sees only the categories assigned below.' : 'Name only: you will type this judge’s paper scores in the Encode Scores tab.'}
                />
                {modal.withLogin && loginFields}
              </>
            )}
            <Field label="Seat number" hint="Column order on tally sheets (Judge 1, Judge 2…). Leave blank for the next seat.">
              <Input type="number" min="1" value={modal.order} onChange={(e) => setModal({ ...modal, order: e.target.value })} className="w-32" />
            </Field>
            <Field label="Categories to judge" hint="The judge can score only these. Locked categories must be reopened before their panel changes.">
              <div className="grid gap-2 sm:grid-cols-2">
                {categories.map((c) => (
                  <label key={c._id} className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={c.configLocked}
                      checked={modal.categories.includes(c._id)}
                      onChange={(e) => setModal({ ...modal, categories: e.target.checked ? [...modal.categories, c._id] : modal.categories.filter((x) => x !== c._id) })}
                      className="rounded border-ink-300"
                    />
                    {c.name}
                    {c.configLocked && <span className="ml-auto text-[11px] text-ink-400">locked</span>}
                  </label>
                ))}
                {!categories.length && <p className="text-sm text-ink-500">No categories yet.</p>}
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
