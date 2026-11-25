import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarRange, ChevronDown, ClipboardCheck, Globe, History, LayoutDashboard, LogOut, Menu, ScrollText, Settings, UserCircle, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../lib/format';
import { Avatar, cx } from '../ui';
import NotificationBell from './NotificationBell';
import Logo from '../Logo';
import ErrorBoundary from '../ErrorBoundary';
import { confirmAction } from '../../lib/alerts';

const NAV = {
  super_admin: [
    { section: 'Overview', items: [{ to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    {
      section: 'Competitions',
      items: [{ to: '/app/events', label: 'Events', icon: CalendarRange }],
    },
    {
      section: 'Administration',
      items: [
        { to: '/app/audit-logs', label: 'Audit Logs', icon: ScrollText },
        { to: '/app/settings', label: 'System Settings', icon: Settings },
      ],
    },
  ],
  event_admin: [
    { section: 'Overview', items: [{ to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    { section: 'Competitions', items: [{ to: '/app/events', label: 'My Events', icon: CalendarRange }] },
    {
      section: 'Administration',
      items: [
        { to: '/app/audit-logs', label: 'Activity Logs', icon: ScrollText },
      ],
    },
  ],
  tabulator: [
    { section: 'Overview', items: [{ to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    { section: 'Tabulation', items: [{ to: '/app/events', label: 'Assigned Events', icon: BarChart3 }] },
  ],
  judge: [
    {
      section: 'Judging',
      items: [
        { to: '/app/judging', label: 'My Score Sheets', icon: ClipboardCheck, end: true },
        { to: '/app/judging/history', label: 'Submission History', icon: History },
      ],
    },
  ],
};

function Sidebar({ user, onNavigate }) {
  const groups = NAV[user.role] || [];
  return (
    <div className="flex h-full flex-col border-r border-ink-200 bg-ink-100/60">
      <Link to="/app" onClick={onNavigate} className="flex h-14 items-center px-4">
        <Logo sub="Scoring & tabulation" />
      </Link>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pt-4 pb-5">
        {groups.map((g) => (
          <div key={g.section}>
            <p className="label-caps mb-1.5 px-2.5">{g.section}</p>
            <div className="space-y-px">
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm transition-colors',
                      isActive ? 'bg-white font-medium text-ink-900 shadow-sm ring-1 ring-ink-200 before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-sm before:bg-brand-600' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                    )
                  }
                >
                  <Icon className="size-4 text-current opacity-80" strokeWidth={1.75} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-ink-200 p-3">
        <Link to="/" target="_blank" className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm text-ink-600 hover:bg-ink-100 hover:text-ink-900">
          <Globe className="size-4" strokeWidth={1.75} /> Public results
          <span className="ml-auto text-[11px] text-ink-400">↗</span>
        </Link>
      </div>
    </div>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-md py-1 pr-2 pl-1 hover:bg-ink-100">
        <Avatar name={user.name} size="sm" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium text-ink-800">{user.name}</span>
          <span className="block text-[11px] text-ink-500">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-ink-400 sm:block" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
          <div className="border-b border-ink-100 px-4 py-2.5">
            <p className="truncate text-sm font-medium text-ink-800">{user.name}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
          </div>
          <Link to="/app/profile" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50">
            <UserCircle className="size-4" /> Profile & password
          </Link>
          <button type="button" onClick={onLogout} className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-700 hover:bg-red-50">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const handleLogout = async () => {
    if (await confirmAction({ title: 'Sign out?', confirmText: 'Sign out' })) {
      await logout();
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar user={user} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw]">
            <Sidebar user={user} onNavigate={() => setMobileOpen(false)} />
            <button type="button" onClick={() => setMobileOpen(false)} className="absolute top-4 -right-11 inline-flex size-9 items-center justify-center rounded-md bg-white text-ink-700" aria-label="Close menu">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-200 bg-ink-50/95 px-4 backdrop-blur-sm sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="inline-flex size-9 items-center justify-center rounded-md text-ink-600 hover:bg-ink-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <p className="hidden font-mono text-xs text-ink-500 md:block">{new Date().toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell />
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
