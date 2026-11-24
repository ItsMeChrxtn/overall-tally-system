import { Field, Input } from '../../components/ui';

export function validatePassword(pw, confirm, min = 8) {
  if (!pw || pw.length < min) return `Password must be at least ${min} characters.`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  if (confirm !== undefined && pw !== confirm) return 'Passwords do not match.';
  return '';
}

export default function PasswordFields({ value, onChange, withCurrent = false }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="space-y-4">
      {withCurrent && (
        <Field label="Current password" required>
          <Input type="password" autoComplete="current-password" value={value.current || ''} onChange={set('current')} />
        </Field>
      )}
      <Field label="New password" required hint="At least 8 characters with letters and numbers.">
        <Input type="password" autoComplete="new-password" value={value.password || ''} onChange={set('password')} />
      </Field>
      <Field label="Confirm new password" required>
        <Input type="password" autoComplete="new-password" value={value.confirm || ''} onChange={set('confirm')} />
      </Field>
    </div>
  );
}
