import { cx } from './ui';

/** Four strokes and a cross-bar: the way a count of five is kept by hand. */
export function TallyMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 4.5v15M10 4.5v15M14 4.5v15M18 4.5v15" />
      <path d="M3.5 16.5 20.5 7.5" stroke="#ffc72c" strokeWidth="2.6" />
    </svg>
  );
}

/** NU blue tile with a gold tally stroke. `inverted` is for use on the navy sidebar. */
export default function Logo({ name = 'Overall Tally', sub, inverted = false, className }) {
  return (
    <span className={cx('flex items-center gap-3', className)}>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-navy-900 text-white shadow-lg ring-1 ring-white/10">
        <TallyMark className="size-5" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className={cx('block truncate font-display text-[16px] font-semibold tracking-tight', inverted ? 'text-white' : 'text-ink-900')}>{name}</span>
        {sub && <span className={cx('block truncate text-[11.5px]', inverted ? 'text-[#7f8cba]' : 'text-ink-500')}>{sub}</span>}
      </span>
    </span>
  );
}
