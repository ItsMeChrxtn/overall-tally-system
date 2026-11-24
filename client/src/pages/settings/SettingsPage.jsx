import { useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import api from '../../api/client';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, PageSkeleton, Select, Toggle } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { showError, toast } from '../../lib/alerts';

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings').then(({ data }) => setS(data.settings)).catch((err) => showError(err));
  }, []);

  const save = async () => {
    if (!s.systemName?.trim()) return showError({ response: { data: { message: 'System name is required.' } } });
    setSaving(true);
    try {
      const { data } = await api.put('/settings', {
        systemName: s.systemName.trim(),
        organizationName: s.organizationName,
        reportSubheading: s.reportSubheading || '',
        publicResultsEnabled: s.publicResultsEnabled,
        defaultDecimalPlaces: Number(s.defaultDecimalPlaces),
        passwordMinLength: Number(s.passwordMinLength),
        reportFooter: s.reportFooter,
      });
      setS(data.settings);
      toast.success('Settings saved');
    } catch (err) {
      showError(err, 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <PageSkeleton />;
  return (
    <div className="max-w-3xl">
      <PageHeader title="System settings" description="Platform-wide configuration. Changes are recorded in the audit log." actions={<Button icon={Save} onClick={save} loading={saving}>Save settings</Button>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Branding" description="Shown in the public site header and on every report." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="System name" required>
              <Input value={s.systemName} onChange={(e) => setS({ ...s, systemName: e.target.value })} />
            </Field>
            <Field label="Organization name">
              <Input value={s.organizationName} onChange={(e) => setS({ ...s, organizationName: e.target.value })} />
            </Field>
            <Field label="Report subheading" hint="Second line on every report, e.g. SIT Week 2026." className="sm:col-span-2">
              <Input value={s.reportSubheading || ''} onChange={(e) => setS({ ...s, reportSubheading: e.target.value })} placeholder="SIT Week 2026" />
            </Field>
            <Field label="Report footer" className="sm:col-span-2">
              <Input value={s.reportFooter} onChange={(e) => setS({ ...s, reportFooter: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Public results" />
          <div className="p-5">
            <Toggle checked={s.publicResultsEnabled} onChange={(v) => setS({ ...s, publicResultsEnabled: v })} label="Enable the public results site" description="When off, no results are visible to the public, even published ones." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Security & defaults" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Minimum password length">
              <Input type="number" min="8" max="64" value={s.passwordMinLength} onChange={(e) => setS({ ...s, passwordMinLength: e.target.value })} />
            </Field>
            <Field label="Default result decimal places">
              <Select value={s.defaultDecimalPlaces} onChange={(e) => setS({ ...s, defaultDecimalPlaces: e.target.value })}>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="px-5 pb-5">
            <Alert tone="gray" icon={ShieldCheck}>
              Passwords are hashed with bcrypt. Sessions use signed JWTs that are revoked automatically on password change, role change or deactivation.
            </Alert>
          </div>
        </Card>
        <p className="text-xs text-slate-500">Last updated {formatDateTime(s.updatedAt)}</p>
      </div>
    </div>
  );
}
