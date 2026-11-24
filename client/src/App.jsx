import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute, { homePathFor } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import AppLayout from './components/layout/AppLayout';
import PublicLayout from './components/layout/PublicLayout';
import { FullPageSpinner } from './components/ui';

import LandingPage from './pages/public/LandingPage';
import PublicResultsPage from './pages/public/PublicResultsPage';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import ChangePasswordRequired from './pages/auth/ChangePasswordRequired';
import DashboardPage from './pages/dashboard/DashboardPage';
import EventsPage from './pages/events/EventsPage';
import EventWorkspace from './pages/events/EventWorkspace';
import OverviewTab from './pages/events/OverviewTab';
import CategoriesTab from './pages/events/CategoriesTab';
import CategoryDetail from './pages/events/CategoryDetail';
import ContestantsTab from './pages/events/ContestantsTab';
import StaffTab from './pages/events/StaffTab';
import EncodeTab from './pages/events/EncodeTab';
import MonitoringTab from './pages/events/MonitoringTab';
import TallyTab from './pages/events/TallyTab';
import ResultDetail from './pages/events/ResultDetail';
import ReportsTab from './pages/events/ReportsTab';
import EventAuditTab from './pages/events/EventAuditTab';
import UsersPage from './pages/users/UsersPage';
import AuditLogsPage from './pages/audit/AuditLogsPage';
import SettingsPage from './pages/settings/SettingsPage';
import ProfilePage from './pages/profile/ProfilePage';
import JudgeHomePage from './pages/judging/JudgeHomePage';
import ScoringPage from './pages/judging/ScoringPage';
import JudgeHistoryPage from './pages/judging/JudgeHistoryPage';
import NotFound from './pages/NotFound';

const STAFF = ['super_admin', 'event_admin', 'tabulator'];
const ADMINS = ['super_admin', 'event_admin'];

function AppIndex() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return <Navigate to={homePathFor(user)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/results/:eventId" element={<PublicResultsPage />} />
      </Route>

      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePasswordRequired />
          </ProtectedRoute>
        }
      />

      <Route path="/app" element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<AppIndex />} />
          <Route path="dashboard" element={<ProtectedRoute roles={STAFF}><DashboardPage /></ProtectedRoute>} />
          <Route path="profile" element={<ProfilePage />} />

          <Route path="events" element={<ProtectedRoute roles={STAFF}><EventsPage /></ProtectedRoute>} />
          <Route path="events/:eventId" element={<ProtectedRoute roles={STAFF}><EventWorkspace /></ProtectedRoute>}>
            <Route index element={<OverviewTab />} />
            <Route path="categories" element={<CategoriesTab />} />
            <Route path="categories/:categoryId" element={<CategoryDetail />} />
            <Route path="contestants" element={<ContestantsTab />} />
            <Route path="staff" element={<StaffTab />} />
            <Route path="encode" element={<EncodeTab />} />
            <Route path="monitoring" element={<MonitoringTab />} />
            <Route path="tally" element={<TallyTab />} />
            <Route path="results/:resultId" element={<ResultDetail />} />
            <Route path="reports" element={<ReportsTab />} />
            <Route path="audit" element={<EventAuditTab />} />
          </Route>

          <Route path="users" element={<ProtectedRoute roles={ADMINS}><UsersPage /></ProtectedRoute>} />
          <Route path="audit-logs" element={<ProtectedRoute roles={ADMINS}><AuditLogsPage /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute roles={['super_admin']}><SettingsPage /></ProtectedRoute>} />

          <Route path="judging" element={<ProtectedRoute roles={['judge']}><JudgeHomePage /></ProtectedRoute>} />
          <Route path="judging/history" element={<ProtectedRoute roles={['judge']}><JudgeHistoryPage /></ProtectedRoute>} />
          <Route path="judging/:categoryId" element={<ProtectedRoute roles={['judge']}><ScoringPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFound inApp />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
