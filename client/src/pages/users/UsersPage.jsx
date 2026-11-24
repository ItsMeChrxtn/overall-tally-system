import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, KeyRound, Pencil, Power, UserPlus, Users } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader, SearchInput, Select, TableSkeleton, Toggle } from '../../components/ui';
import { ROLE_LABELS, formatDateTime } from '../../lib/format';
import { confirmAction, showError, toast } from '../../lib/alerts';
import { validatePassword } from '../auth/PasswordFields';

const ROLE_TONE = { super_admin: 'red', event_admin: 'brand', tabulator: 'violet', judge: 'blue' };

function suggestPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const pick = (s, n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => s[x % s.length]).join('');
  return `${pick(chars, 6)}${pick('23456789', 3)}${pick('!@#$%', 1)}`;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const roles = me.role === 'super_admin' ? ['super_admin', 'event_admin', 'tabulator', 'judge'] : ['judge', 'tabulator'];
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setData(null);
    api
      .get('/users', { params: { q: q || undefined, role: role || undefined, status: status || undefined, page, limit: 20 } })
      .then(({ data: d }) => setData(d))
      .catch((err) => {
        setData({ items: [], total: 0, pages: 1 });
        showError(err);
      });
  }, [q, role, status, page]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => setPage(1), [q, role, status]);

  const openCreate = () => {
    setErrors({});
    setModal({ mode: 'create', name: '', email: '', role: roles.includes('judge') ? 'judge' : roles[0], title: '', affiliation: '', phone: '', password: suggestPassword(), mustChangePassword: true });
  };
  const openEdit = (u) => {
    setErrors({});
    setModal({ mode: 'edit', ...u, title: u.title || '', affiliation: u.affiliation || '', phone: u.phone || '' });
  };

  const save = async () => {
    const e = {};
    if (!modal.name.trim() || modal.name.trim().length < 2) e.name = 'Name is required.';
    if (!/^\S+@\S+\.\S+$/.test(modal.email)) e.email = 'Enter a valid email.';
    if (modal.mode === 'create') {
      const pw = validatePassword(modal.password);
      if (pw) e.password = pw;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const body = { name: modal.name.trim(), email: modal.email.trim(), role: modal.role, title: modal.title, affiliation: modal.affiliation, phone: modal.phone };
      if (modal.mode === 'create') {
        await api.post('/users', { ...body, password: modal.password, mustChangePassword: modal.mustChangePassword });
        toast.success('Account created. Share the temporary password securely.');
      } else {
        await api.patch(`/users/${modal._id}`, body);
        toast.success('Account updated');
      }
      setModal(null);
      load();
    } catch (err) {
      showError(err, 'Could not save account');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (u) => {
    const next = u.status === 'active' ? 'inactive' : 'active';
    if (!(await confirmAction({ title: `${next === 'active' ? 'Activate' : 'Deactivate'} ${u.name}?`, text: next === 'inactive' ? 'They will be signed out immediately and cannot sign in.' : undefined, confirmText: next === 'active' ? 'Activate' : 'Deactivate', danger: next === 'inactive' }))) return;
    try {
      await api.patch(`/users/${u._id}/status`, { status: next });
      toast.success(`Account ${next === 'active' ? 'activated' : 'deactivated'}`);
      load();
    } catch (err) {
      showError(err);
    }
  };

  const resetPassword = async (u) => {
    const temp = suggestPassword();
    if (!(await confirmAction({ title: `Reset password for ${u.name}?`, text: `A temporary password will be set: ${temp}\nThey must change it at next sign-in. Copy it before confirming.`, confirmText: 'Set temporary password' }))) return;
    try {
      await api.post(`/users/${u._id}/reset-password`, { password: temp });
      toast.success('Temporary password set');
    } catch (err) {
      showError(err);
    }
  };

  return (
    <div>
      <PageHeader
        title={me.role === 'super_admin' ? 'Users' : 'Judges & tabulators'}
        description={me.role === 'super_admin' ? 'Manage every account and role on the platform.' : 'Create and manage judge and tabulator accounts, then assign them to your events.'}
        actions={
          <Button icon={UserPlus} onClick={openCreate}>
            New account
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 px-5 py-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, email, affiliation" className="w-full sm:w-72" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-full sm:w-44">
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-36">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        {!data ? (
          <TableSkeleton rows={8} />
        ) : data.items.length === 0 ? (
          <EmptyState icon={Users} title="No accounts found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Title / affiliation</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th className="w-32" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u._id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">
                            {u.name} {u._id === me._id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                          </p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    </td>
                    <td className="text-slate-600">{[u.title, u.affiliation].filter(Boolean).join(' · ') || '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={u.status === 'active' ? 'green' : 'red'} dot>
                          {u.status}
                        </Badge>
                        {u.mustChangePassword && <Badge tone="amber">temp password</Badge>}
                      </div>
                    </td>
                    <td className="text-xs text-slate-500">{formatDateTime(u.lastLoginAt)}</td>
                    <td>
                      <div className="flex justify-end">
                        <IconButton icon={Pencil} label="Edit" onClick={() => openEdit(u)} />
                        <IconButton icon={KeyRound} label="Reset password" onClick={() => resetPassword(u)} />
                        {u._id !== me._id && <IconButton icon={Power} label={u.status === 'active' ? 'Deactivate' : 'Activate'} onClick={() => toggleStatus(u)} className={u.status === 'active' ? 'hover:text-red-600' : 'hover:text-emerald-600'} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span>
              {data.total} accounts · page {data.page} of {data.pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === 'create' ? 'Create account' : 'Edit account'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              {modal?.mode === 'create' ? 'Create account' : 'Save'}
            </Button>
          </>
        }
      >
        {modal && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.name} className="sm:col-span-2">
              <Input value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} invalid={!!errors.name} />
            </Field>
            <Field label="Email" required error={errors.email}>
              <Input type="email" value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} invalid={!!errors.email} />
            </Field>
            <Field label="Role" required hint={modal.mode === 'edit' ? 'Remove event assignments before changing roles.' : undefined}>
              <Select value={modal.role} onChange={(e) => setModal({ ...modal, role: e.target.value })} disabled={modal.mode === 'edit' && modal._id === me._id}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" hint="Shown on judge reports">
              <Input value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} placeholder="e.g. Professional Choreographer" />
            </Field>
            <Field label="Affiliation">
              <Input value={modal.affiliation} onChange={(e) => setModal({ ...modal, affiliation: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={modal.phone} onChange={(e) => setModal({ ...modal, phone: e.target.value })} />
            </Field>
            {modal.mode === 'create' && (
              <>
                <Field label="Temporary password" required error={errors.password} hint="Share it with the user through a secure channel.">
                  <div className="flex gap-2">
                    <Input value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} invalid={!!errors.password} className="font-mono" />
                    <Button variant="secondary" size="md" onClick={() => setModal({ ...modal, password: suggestPassword() })}>
                      New
                    </Button>
                  </div>
                </Field>
                <div className="sm:col-span-2">
                  <Toggle checked={modal.mustChangePassword} onChange={(v) => setModal({ ...modal, mustChangePassword: v })} label="Require password change at first sign-in" />
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
