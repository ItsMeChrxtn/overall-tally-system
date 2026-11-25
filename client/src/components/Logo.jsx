import { cx } from './ui';

/** Four strokes and a cross-bar: the way a count of five is kept by hand. */
export function TallyMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 4.5v15M10 4.5v15M14 4.5v15M18 4.5v15" />
      <path d="M3.5 16.5 20.5 7.5" strokeWidth="2.25" />
    </svg>
  );
}

export default function Logo({ name = 'Overall Tally', sub, inverted = false, className }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <span className={cx('inline-flex size-8 shrink-0 items-center justify-center rounded-md', inverted ? 'bg-white text-brand-700' : 'bg-brand-700 text-white')}>
        <TallyMark className="size-[18px]" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className={cx('block truncate text-[15px] font-semibold', inverted ? 'text-white' : 'text-ink-900')}>{name}</span>
        {sub && <span className={cx('block truncate text-[11px]', inverted ? 'text-white/60' : 'text-ink-500')}>{sub}</span>}
      </span>
    </span>
  );
}
