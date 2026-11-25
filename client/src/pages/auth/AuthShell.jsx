import { Link } from 'react-router-dom';
import Logo from '../../components/Logo';

const FACTS = [
  ['Judges', 'Score every assigned category on one sheet'],
  ['Tabulators', 'Verify sheets and generate the tally'],
  ['Organizers', 'Approve before results go public'],
];

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(420px,1fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <Link to="/" className="hidden w-fit lg:block">
          <Logo sub="NU MOA · Scoring & tabulation" />
        </Link>
        <div className="nu-rise my-auto w-full max-w-[400px] py-8">
          <h1 className="text-[32px] leading-tight font-semibold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-2 mb-8 text-[15px] leading-relaxed text-ink-600">{subtitle}</p>}
          <div className={subtitle ? '' : 'mt-8'}>{children}</div>
        </div>
        <p className="text-center text-xs text-ink-400 lg:text-left">Authorized personnel only. All activity is logged.</p>
      </div>

      <div className="relative order-first h-60 p-2.5 pb-0 lg:sticky lg:top-0 lg:order-none lg:h-screen lg:p-3.5 lg:pl-0">
        <div className="relative isolate h-full overflow-hidden rounded-[22px] bg-navy-800 bg-[url('/nu-moa.jpg')] bg-cover bg-[42%_30%] lg:rounded-[28px]">
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,#0f1540_0%,#0f1540cc_28%,#0f154000_62%),linear-gradient(180deg,#0f154066_0%,transparent_25%)]" />
          <span className="absolute top-5 left-5 rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-ink-900 lg:top-6 lg:left-6">National University · Mall of Asia</span>
          <div className="nu-rise absolute inset-x-0 bottom-0 px-6 pb-6 text-white lg:px-12 lg:pb-11">
            <h2 className="max-w-xl text-2xl leading-tight font-bold lg:text-[38px]">Fair, transparent scoring for every NU MOA competition.</h2>
            <p className="mt-3.5 hidden max-w-lg text-[15px] leading-relaxed text-[#d6daef] lg:block">From pageants and film festivals to quiz bees — judges score, tabulators verify, and results are released only after approval.</p>
            <dl className="mt-7 hidden max-w-2xl grid-cols-3 border-t border-white/20 lg:grid">
              {FACTS.map(([t, d], i) => (
                <div key={t} className={i ? 'border-l border-white/15 pt-4 pl-4' : 'pt-4 pr-4'}>
                  <dt className="text-sm font-semibold text-gold-400">{t}</dt>
                  <dd className="mt-1 text-[13px] leading-snug text-[#c9cee8]">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
