import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import api, { apiErrorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { homePathFor } from '../../auth/ProtectedRoute';
import { Alert, Button } from '../../components/ui';
import { toast } from '../../lib/alerts';
import AuthShell from './AuthShell';
import PasswordFields, { validatePassword } from './PasswordFields';

export default function ChangePasswordRequired() {
  const { user, applySession, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.current) return setError('Enter your current (temporary) password.');
    const v = validatePassword(form.password, form.confirm);
    if (v) return setError(v);
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/auth/change-password', { currentPassword: form.current, newPassword: form.password });
      applySession(data.token, data.user);
      toast.success('Password updated.');
      navigate(homePathFor(data.user), { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Set a new password" subtitle={`Welcome, ${user?.name}. For security, replace the temporary password before continuing.`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Alert tone="blue" icon={KeyRound}>
          Your account was created or reset by an administrator.
        </Alert>
        {error && <Alert tone="red">{error}</Alert>}
        <PasswordFields value={form} onChange={setForm} withCurrent />
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          Update password
        </Button>
        <button type="button" onClick={() => logout().then(() => navigate('/login'))} className="w-full text-center text-sm text-slate-500 hover:text-slate-800">
          Sign out instead
        </button>
      </form>
    </AuthShell>
  );
}
