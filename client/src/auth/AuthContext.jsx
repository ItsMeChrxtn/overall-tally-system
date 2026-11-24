import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import api, { TOKEN_KEY } from '../api/client';
import { connectSocket, disconnectSocket } from '../lib/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    disconnectSocket();
    setUser(null);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        connectSocket();
      })
      .catch(() => clear())
      .finally(() => setLoading(false));
  }, [clear]);

  // Session expiration handling from the axios interceptor
  useEffect(() => {
    const onExpired = (e) => {
      if (!localStorage.getItem(TOKEN_KEY)) return;
      clear();
      Swal.fire({ icon: 'info', title: 'Session ended', text: e.detail?.message || 'Please sign in again.' });
    };
    const onPasswordChange = () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
    window.addEventListener('auth:expired', onExpired);
    window.addEventListener('auth:password-change', onPasswordChange);
    return () => {
      window.removeEventListener('auth:expired', onExpired);
      window.removeEventListener('auth:password-change', onPasswordChange);
    };
  }, [clear]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    connectSocket();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* token may already be invalid */
    }
    clear();
  }, [clear]);

  const applySession = useCallback((token, nextUser) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    setUser(nextUser);
    connectSocket();
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, applySession, setUser }), [user, loading, login, logout, applySession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export const isAdmin = (user) => user && ['super_admin', 'event_admin'].includes(user.role);
export const isStaff = (user) => user && ['super_admin', 'event_admin', 'tabulator'].includes(user.role);
