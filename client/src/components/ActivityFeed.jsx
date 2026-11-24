import { Activity } from 'lucide-react';
import { EmptyState } from './ui';
import { timeAgo, titleCase } from '../lib/format';

export function actionLabel(action = '') {
  const map = {
    'auth.login': 'Signed in',
    'auth.logout': 'Signed out',
    'auth.login_failed': 'Failed sign-in attempt',
    'score.submitted': 'Submitted a score sheet',
    'score.submitted_batch': 'Submitted score sheets',
    'score.resubmitted': 'Resubmitted a corrected score sheet',
    'score.correction_reopened': 'Reopened a score sheet for correction',
    'result.generated': 'Generated a tally version',
    'result.submitted': 'Submitted results for approval',
    'result.approved': 'Approved results',
    'result.returned': 'Returned results for correction',
    'result.published': 'Published results',
    'result.unpublished': 'Unpublished results',
    'category.config_locked': 'Locked configuration & opened scoring',
    'category.config_reopened': 'Reopened scoring configuration',
    'report.exported': 'Exported a report',
  };
  return map[action] || titleCase(action.replace('.', ' · '));
}

export default function ActivityFeed({ items, showEvent = true }) {
  if (!items?.length) return <EmptyState icon={Activity} title="No activity yet" />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((l) => (
        <li key={l._id} className="flex gap-3 px-5 py-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">{l.userName || 'System'}</span> {actionLabel(l.action).toLowerCase()}
              {l.entityLabel && <span className="text-slate-500"> — {l.entityLabel}</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {timeAgo(l.createdAt)}
              {showEvent && l.event?.name && ` · ${l.event.name}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
