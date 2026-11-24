import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../../api/client';
import { Alert, Button } from '../../components/ui';
import { toast } from '../../lib/alerts';
import AuthShell from './AuthShell';
import PasswordFields, { validatePassword } from './PasswordFields';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const v = validatePassword(form.password, form.confirm);
    if (v) return setError(v);
    setBusy(true);
    setError('');
    try {
      await api.post(`/auth/reset-password/${token}`, { password: form.password });
      toast.success('Password reset. Please sign in.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="red">{error}</Alert>}
        <PasswordFields value={form} onChange={setForm} />
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          Reset password
        </Button>
        <p className="text-center text-sm">
          <Link to="/login" className="font-medium text-brand-600">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
