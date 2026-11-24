import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { FullPageSpinner } from '../components/ui';

/** Guards routes by authentication and (optionally) role. Forces the password-change screen when required. */
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/app/dashboard" replace />;
  return children || <Outlet />;
}

export function homePathFor(user) {
  if (!user) return '/login';
  if (user.mustChangePassword) return '/change-password';
  return user.role === 'judge' ? '/app/judging' : '/app/dashboard';
}
