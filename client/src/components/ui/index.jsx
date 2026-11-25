import { forwardRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { Inbox, Loader2, Search, X } from 'lucide-react';
import { fileUrl } from '../../api/client';
import { initials } from '../../lib/format';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

// ------------------------------------------------------------------ Buttons
const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary: 'bg-white text-ink-800 border border-ink-300 hover:border-ink-400 hover:bg-ink-50 active:bg-ink-100 disabled:text-ink-400 disabled:hover:border-ink-300',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
  success: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:text-ink-300',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:text-brand-300',
};
const SIZES = { xs: 'h-7 px-2 text-xs gap-1', sm: 'h-8 px-2.5 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-10 px-4 text-sm gap-2' };

export const Button = forwardRef(function Button({ variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-1 focus-visible:outline-none disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className={size === 'xs' ? 'size-3.5' : 'size-4'} strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: Icon, label, className, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex size-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40', className)} {...props}>
      <Icon className="size-4" strokeWidth={1.75} />
    </button>
  );
}

// ------------------------------------------------------------------ Form controls
const control =
  'block w-full rounded-md border border-ink-300 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 transition-colors hover:border-ink-400 focus:border-brand-600 focus:ring-3 focus:ring-brand-600/12 focus:outline-none disabled:bg-ink-50 disabled:text-ink-500 disabled:hover:border-ink-300';

export function Field({ label, hint, error, required, children, className, htmlFor }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink-700">
          {label}
          {required && <span className="ml-0.5 text-red-600">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} className={cx(control, 'h-9', invalid && 'border-red-500 focus:border-red-600 focus:ring-red-600/12', className)} {...props} />;
});

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx(control, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(control, 'py-2 leading-relaxed', className)} {...props} />;
});

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cx('flex items-start gap-3', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors', checked ? 'border-brand-600 bg-brand-600' : 'border-ink-300 bg-ink-200')}
      >
        <span className={cx('absolute top-px size-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-4' : 'translate-x-px')} />
      </button>
      {(label || description) && (
        <span>
          {label && <span className="block text-sm font-medium text-ink-800">{label}</span>}
          {description && <span className="block text-xs text-ink-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', className }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" strokeWidth={1.75} />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

// ------------------------------------------------------------------ Display
const TONES = {
  gray: 'bg-ink-100 text-ink-700 border-ink-200',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  blue: 'bg-sky-50 text-sky-800 border-sky-200',
  green: 'bg-brand-50 text-brand-700 border-brand-200',
  amber: 'bg-gold-50 text-gold-700 border-gold-100',
  red: 'bg-red-50 text-red-800 border-red-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
  solid: 'bg-ink-900 text-ink-50 border-ink-900',
};
export function Badge({ tone = 'gray', children, className, dot }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-[4px] border px-1.5 py-px text-[11.5px] leading-[18px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-[1px] bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function Card({ className, children, padded = false }) {
  return <div className={cx('rounded-lg border border-ink-200 bg-white', padded && 'p-5', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-ink-200 pb-5">
      <div className="min-w-0">
        {eyebrow && <div className="label-caps mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] leading-tight font-semibold text-ink-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A row of figures that share one frame, like the totals line of a tally sheet.
 * Put <StatCard> elements inside and give it the grid columns via className.
 */
export function StatGroup({ children, className }) {
  return <div className={cx('grid gap-px overflow-hidden rounded-lg border border-ink-200 bg-ink-200', className)}>{children}</div>;
}

const STAT_ACCENT = { brand: 'bg-brand-500', green: 'bg-brand-500', amber: 'bg-gold-500', red: 'bg-red-600', blue: 'bg-sky-600', violet: 'bg-violet-500', gray: 'bg-ink-400' };
export function StatCard({ label, value, icon: Icon, hint, tone = 'gray' }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <span className={cx('h-3 w-[3px] shrink-0 rounded-[1px]', STAT_ACCENT[tone] || STAT_ACCENT.gray)} />
        <span className="truncate">{label}</span>
        {Icon && <Icon className="ml-auto size-3.5 shrink-0 text-ink-300" strokeWidth={1.75} />}
      </p>
      <p className="mt-2 text-[26px] leading-none font-medium text-ink-900 tabular-nums">{value ?? '—'}</p>
      {hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value = 0, max = 100, tone, className, showLabel }) {
  const p = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = tone || (p >= 100 ? 'bg-brand-600' : p >= 50 ? 'bg-ink-600' : 'bg-gold-500');
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div className="h-1 w-full overflow-hidden rounded-[1px] bg-ink-100">
        <div className={cx('h-full transition-all', color)} style={{ width: `${p}%` }} />
      </div>
      {showLabel && <span className="w-9 shrink-0 text-right text-xs text-ink-500 tabular-nums">{p}%</span>}
    </div>
  );
}

export function Avatar({ name, src, size = 'md', className }) {
  const s = { sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-12 text-sm', xl: 'size-16 text-base' }[size];
  if (src) return <img src={fileUrl(src)} alt={name} className={cx('shrink-0 rounded-full object-cover ring-1 ring-ink-200', s, className)} />;
  return <span className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-ink-100 font-medium text-ink-600 ring-1 ring-ink-200 ring-inset', s, className)}>{initials(name) || '?'}</span>;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <Icon className="mb-3 size-6 text-ink-300" strokeWidth={1.5} />
      <p className="text-sm font-medium text-ink-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cx('animate-pulse rounded-md bg-ink-200/60', className)} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cx('h-4', c === 0 ? 'w-1/3' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20" />
      <Skeleton className="h-72" />
    </div>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx('size-5 animate-spin text-ink-500', className)} />;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

// ------------------------------------------------------------------ Modal
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-ink-950/35" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-lg border border-ink-200 bg-white shadow-xl sm:rounded-lg', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} className="-mt-1 -mr-2" />
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------ Tabs (router-based)
export function TabNav({ items }) {
  return (
    <div className="-mx-4 mb-6 overflow-x-auto border-b border-ink-200 px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-5">
        {items.map(({ to, label, icon: Icon, end, count }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cx('-mb-px inline-flex items-center gap-1.5 border-b-2 py-2.5 text-sm transition-colors', isActive ? 'border-ink-900 font-medium text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900')
            }
          >
            {Icon && <Icon className="size-4" strokeWidth={1.75} />}
            {label}
            {count !== undefined && <span className="text-[11px] text-ink-400 tabular-nums">{count}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-md border border-ink-200 bg-ink-100/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx('rounded-[4px] px-3 py-1 text-xs font-medium transition-colors', value === o.value ? 'bg-white text-ink-900 shadow-sm ring-1 ring-ink-200' : 'text-ink-500 hover:text-ink-900')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Alert({ tone = 'amber', icon: Icon, title, children, className }) {
  const map = {
    amber: 'border-gold-500 bg-gold-50 text-gold-700',
    red: 'border-red-600 bg-red-50 text-red-900',
    blue: 'border-sky-600 bg-sky-50 text-sky-900',
    green: 'border-brand-600 bg-brand-50 text-brand-800',
    gray: 'border-ink-400 bg-ink-100/60 text-ink-800',
  };
  return (
    <div className={cx('flex gap-3 rounded-r-md border-l-[3px] px-4 py-3 text-sm', map[tone], className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}
