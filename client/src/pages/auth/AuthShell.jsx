import { Link } from 'react-router-dom';
import { BarChart3, CheckCircle2 } from 'lucide-react';

const POINTS = ['Configurable criteria and scoring methods per event', 'Locked judge submissions with full audit trail', 'Automatic tally, tie-breaking and approval workflow'];

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="hidden flex-col justify-between bg-slate-900 p-10 text-slate-300 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BarChart3 className="size-5" />
          </span>
          <span className="text-base font-semibold text-white">Overall Tally</span>
        </Link>
        <div className="max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight text-white">Accurate, transparent competition scoring.</h2>
          <p className="mt-3 text-sm text-slate-400">One platform for pageants, dance, singing, sports and academic competitions — from criteria setup to published results.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-400" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">Authorized personnel only. All activity is logged.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <BarChart3 className="size-4.5" />
            </span>
            <span className="text-sm font-semibold text-slate-900">Overall Tally</span>
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
