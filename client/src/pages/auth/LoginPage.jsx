import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { homePathFor } from '../../auth/ProtectedRoute';
import { apiErrorMessage } from '../../api/client';
import { Alert, Button, Field, Input } from '../../components/ui';
import AuthShell from './AuthShell';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePathFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email || !form.password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      const u = await login(form.email.trim(), form.password);
      const from = location.state?.from;
      navigate(u.mustChangePassword ? '/change-password' : from && from.startsWith('/app') ? from : homePathFor(u), { replace: true });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Use the account provided by your event organizer.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="red">{error}</Alert>}
        <Field label="Email address" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <div className="relative">
            <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="pr-10" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-ink-400 hover:text-ink-600" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-500">
        Looking for results?{' '}
        <Link to="/" className="font-medium text-brand-600 hover:text-brand-700">
          View published results
        </Link>
      </p>
    </AuthShell>
  );
}
