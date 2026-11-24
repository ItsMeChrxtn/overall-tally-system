export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  event_admin: 'Event Admin',
  judge: 'Judge',
  tabulator: 'Tabulator',
};

export const EVENT_TYPES = [
  { value: 'pageant', label: 'Beauty Pageant' },
  { value: 'dance', label: 'Dance Competition' },
  { value: 'singing', label: 'Singing Competition' },
  { value: 'sports', label: 'Sports Competition' },
  { value: 'academic', label: 'Academic Competition' },
  { value: 'talent', label: 'Talent Competition' },
  { value: 'school', label: 'School-Based Competition' },
  { value: 'other', label: 'Other / Custom' },
];
export const eventTypeLabel = (v) => EVENT_TYPES.find((t) => t.value === v)?.label || v;

export const EVENT_STATUSES = ['draft', 'upcoming', 'active', 'scoring', 'for_verification', 'for_approval', 'published', 'completed', 'archived'];

export const SCORING_METHODS = [
  { value: 'weighted', label: 'Weighted Score', help: 'Each judge score = Σ (score ÷ max × weight). Final = average across judges. Weights must total 100%.' },
  { value: 'average', label: 'Average Score', help: 'Each judge total = sum of criteria. Final = average of judge totals.' },
  { value: 'total', label: 'Total Score', help: 'Final = sum of every judge’s criterion scores.' },
  { value: 'rank', label: 'Rank-Based', help: 'Judges rank contestants directly (1 = best). Lowest rank sum wins.' },
  { value: 'custom', label: 'Custom Strategy', help: 'Pluggable calculation strategies for special formats.' },
];

export const TIE_RULES = [
  { value: 'highest_weight_criterion', label: 'Highest score in the most important (highest-weight) criterion' },
  { value: 'criterion', label: 'Highest score in a designated criterion' },
  { value: 'judge', label: 'Higher score / better placement from a specified judge' },
  { value: 'shared', label: 'Shared ranking (stop here)' },
];

export const titleCase = (s) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');

export function formatDate(d, opts = { dateStyle: 'medium' }) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  // toLocaleDateString rejects timeStyle, so use toLocaleString when a time is requested
  const fn = opts.timeStyle ? 'toLocaleString' : 'toLocaleDateString';
  return date[fn]('en-PH', { timeZone: 'Asia/Manila', ...opts });
}

export function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(d) {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}

export function toDateInput(d) {
  if (!d) return '';
  const date = new Date(d);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function num(v, dp = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(dp);
}

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function ordinal(n) {
  if (n === null || n === undefined) return '—';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function initials(name = '') {
  return name
    .replace(/^(Dr|Mr|Ms|Mrs|Engr|Atty|Prof)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/** Number of decimals as typed (for client-side precision checks). */
export function decimalsOf(value) {
  const s = String(value);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}
