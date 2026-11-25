import { useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '../../components/ui';
import { ROLE_LABELS, formatDateTime } from '../../lib/format';
import { showError, showMessage, toast } from '../../lib/alerts';
import PasswordFields, { validatePassword } from '../auth/PasswordFields';

export default function ProfilePage() {
  const { user, setUser, applySession } = useAuth();
  const [profile, setProfile] = useState({ name: user.name, title: user.title || '', affiliation: user.affiliation || '', phone: user.phone || '' });
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const [busy, setBusy] = useState('');

  const saveProfile = async () => {
    if (profile.name.trim().length < 2) return showMessage('Check the form', 'Name is required.');
    setBusy('profile');
    try {
      const { data } = await api.patch('/auth/profile', profile);
      setUser(data.user);
      toast.success('Profile updated');
    } catch (err) {
      showError(err);
    } finally {
      setBusy('');
    }
  };

  const changePassword = async () => {
    if (!pw.current) return showMessage('Check the form', 'Enter your current password.');
    const v = validatePassword(pw.password, pw.confirm);
    if (v) return showMessage('Check the form', v);
    setBusy('pw');
    try {
      const { data } = await api.post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.password });
      applySession(data.token, data.user);
      setPw({ current: '', password: '', confirm: '' });
      toast.success('Password changed. Other sessions were signed out.');
    } catch (err) {
      showError(err, 'Could not change password');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Profile & security" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your profile" />
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <Avatar name={user.name} size="lg" />
              <div>
                <p className="font-medium text-ink-900">{user.email}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone="brand">{ROLE_LABELS[user.role]}</Badge>
                  <span className="text-xs text-ink-500">Last sign-in {formatDateTime(user.lastLoginAt)}</span>
                </div>
              </div>
            </div>
            <Field label="Full name" required>
              <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="Title">
              <Input value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} />
            </Field>
            <Field label="Affiliation">
              <Input value={profile.affiliation} onChange={(e) => setProfile({ ...profile, affiliation: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </Field>
            <Button icon={Save} onClick={saveProfile} loading={busy === 'profile'}>
              Save profile
            </Button>
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Change password" description="Changing your password signs out your other sessions." />
          <div className="space-y-4 p-5">
            <PasswordFields value={pw} onChange={setPw} withCurrent />
            <Button icon={KeyRound} onClick={changePassword} loading={busy === 'pw'}>
              Update password
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
