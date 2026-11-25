import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { homePathFor } from '../../auth/ProtectedRoute';
import Logo from '../Logo';

export default function PublicLayout() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    api.get('/public/settings').then(({ data }) => setSettings(data.settings)).catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="no-print sticky top-0 z-20 border-b border-ink-200 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link to="/">
            <Logo name={settings?.systemName || 'Overall Tally'} sub={settings?.organizationName} />
          </Link>
          <Link to={user ? homePathFor(user) : '/login'} className="btn-nu inline-flex h-10 items-center rounded-[10px] px-4 text-sm font-semibold text-white">
            {user ? 'Back to workspace' : 'Staff sign in'}
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <Outlet context={{ settings }} />
      </main>
      <footer className="no-print border-t border-ink-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-ink-500 sm:px-6">
          <span>{settings?.organizationName || settings?.systemName || 'Overall Tally'}</span>
          <span>Questions about a result? Contact the event secretariat.</span>
        </div>
      </footer>
    </div>
  );
}
