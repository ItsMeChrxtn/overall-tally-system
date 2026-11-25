import { Badge } from './ui';
import { titleCase } from '../lib/format';

const EVENT = {
  draft: 'gray',
  upcoming: 'blue',
  active: 'brand',
  scoring: 'brand',
  for_verification: 'amber',
  for_approval: 'amber',
  published: 'solid',
  completed: 'solid',
  archived: 'gray',
};
const SHEET = { draft: 'amber', submitted: 'green', reopened: 'red', not_started: 'gray' };
const RESULT = { preliminary: 'blue', for_approval: 'amber', approved: 'brand', returned: 'red', published: 'solid', superseded: 'gray' };
const CATEGORY = { setup: 'gray', scoring: 'brand', closed: 'blue' };
const LABELS = { approved: 'Final', returned: 'Reopened', not_started: 'Not started', for_approval: 'For approval', for_verification: 'For verification', setup: 'Setup', scoring: 'Scoring open', closed: 'Scoring closed' };

export default function StatusBadge({ kind = 'event', status }) {
  if (!status) return <Badge>—</Badge>;
  const map = { event: EVENT, sheet: SHEET, result: RESULT, category: CATEGORY }[kind] || EVENT;
  return (
    <Badge tone={map[status] || 'gray'} dot>
      {LABELS[status] || titleCase(status)}
    </Badge>
  );
}
