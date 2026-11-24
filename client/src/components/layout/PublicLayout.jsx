import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { BarChart3, LogIn } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { homePathFor } from '../../auth/ProtectedRoute';

export default function PublicLayout() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    api.get('/public/settings').then(({ data }) => setSettings(data.settings)).catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <BarChart3 className="size-4.5" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">{settings?.systemName || 'Overall Tally'}</span>
              {settings?.organizationName && <span className="block text-[11px] text-slate-500">{settings.organizationName}</span>}
            </span>
          </Link>
          <Link to={user ? homePathFor(user) : '/login'} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <LogIn className="size-4" />
            {user ? 'Open workspace' : 'Staff sign in'}
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <Outlet context={{ settings }} />
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        Official results are released only after verification and approval by the organizers.
      </footer>
    </div>
  );
}
