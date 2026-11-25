import { Link } from 'react-router-dom';
import Logo from '../../components/Logo';

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(400px,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Link to="/" className="hidden w-fit lg:block">
          <Logo sub="NU MOA · Scoring & tabulation" />
        </Link>
        <div className="my-auto w-full max-w-[360px] py-8">
          <h1 className="text-2xl font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1.5 mb-6 text-sm text-ink-500">{subtitle}</p>}
          <div className={subtitle ? '' : 'mt-6'}>{children}</div>
        </div>
        <p className="text-center text-xs text-ink-400 lg:text-left">Authorized personnel only. All activity is logged.</p>
      </div>

      <div className="relative order-first h-44 p-2.5 pb-0 lg:sticky lg:top-0 lg:order-none lg:h-screen lg:p-3 lg:pl-0">
        <div className="relative isolate h-full overflow-hidden rounded-xl bg-navy-800 bg-[url('/nu-moa.jpg')] bg-cover bg-[42%_30%] lg:rounded-2xl">
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,#0f1540e6_0%,#0f154000_55%)]" />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-6 text-white lg:px-10 lg:pb-9">
            <p className="text-xs font-medium text-gold-400">National University · Mall of Asia</p>
            <p className="mt-1 max-w-md text-lg leading-snug font-semibold lg:text-xl">Competition scoring and tabulation</p>
          </div>
        </div>
      </div>
    </div>
  );
}
