import { Link } from 'react-router-dom';
import Logo, { TallyMark } from '../../components/Logo';

/** Rows of hand-kept tally marks, drawn faintly behind the panel copy. */
function TallyField() {
  const rows = [5, 3, 6, 2, 4];
  return (
    <div className="space-y-5" aria-hidden="true">
      {rows.map((groups, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: groups }).map((_, g) => (
            <TallyMark key={g} className="size-9 text-white/[0.13]" />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen bg-ink-50 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-800 p-10 lg:flex">
        <Link to="/" className="relative">
          <Logo inverted sub="Scoring & tabulation" />
        </Link>
        <div className="relative">
          <TallyField />
          <p className="mt-12 max-w-sm font-display text-[28px] leading-snug text-white">Every score sheet signed, checked and accounted for.</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60">Judges score their own categories. Tabulators verify. Organizers approve before anything goes public.</p>
        </div>
        <p className="relative font-mono text-[11px] text-white/45">Authorized personnel only · activity is logged</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 inline-block lg:hidden">
            <Logo />
          </Link>
          <h1 className="font-display text-[30px] leading-tight font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
