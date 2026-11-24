import { Field, Input, Select, Textarea } from '../../components/ui';
import { SCORING_METHODS } from '../../lib/format';

export const CUSTOM_STRATEGIES = [
  { value: 'trimmed_mean', label: 'Trimmed Mean (drop highest & lowest judge)' },
  { value: 'rank_of_scores', label: 'Rank of Scores (judge scores → ranks, lowest sum wins)' },
];

export function emptyCategory() {
  return { name: '', description: '', instructions: '', scoringMethod: 'weighted', customStrategy: 'trimmed_mean', decimalPlaces: 2 };
}

export function validateCategory(f) {
  const e = {};
  if (!f.name || f.name.trim().length < 2) e.name = 'Category name is required.';
  return e;
}

export default function CategoryForm({ value, onChange, errors = {}, showScoring = true }) {
  const set = (k, transform = (v) => v) => (e) => onChange({ ...value, [k]: transform(e.target.value) });
  const method = SCORING_METHODS.find((m) => m.value === value.scoringMethod);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Category name" required error={errors.name} className="sm:col-span-2">
        <Input value={value.name} onChange={set('name')} placeholder="e.g. Best in Talent" invalid={!!errors.name} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea rows={2} value={value.description} onChange={set('description')} />
      </Field>
      {showScoring && (
        <>
          <Field label="Scoring method" required hint={method?.help}>
            <Select value={value.scoringMethod} onChange={set('scoringMethod')}>
              {SCORING_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Result decimal places">
            <Select value={value.decimalPlaces} onChange={set('decimalPlaces', Number)}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          {value.scoringMethod === 'custom' && (
            <Field label="Custom strategy" required className="sm:col-span-2">
              <Select value={value.customStrategy || ''} onChange={set('customStrategy')}>
                {CUSTOM_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}
      <Field label="Instructions for judges" className="sm:col-span-2">
        <Textarea rows={2} value={value.instructions} onChange={set('instructions')} placeholder="Shown to judges on the score sheet." />
      </Field>
    </div>
  );
}
