import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import AuditLogTable from '../../components/AuditLogTable';
import { PageHeader } from '../../components/ui';

export default function AuditLogsPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  useEffect(() => {
    // "all" includes archived events so their history stays searchable
    api.get('/events', { params: { status: 'all' } }).then(({ data }) => setEvents(data.items)).catch(() => {});
  }, []);
  return (
    <div>
      <PageHeader
        title={user.role === 'super_admin' ? 'Audit logs' : 'Activity logs'}
        description={user.role === 'super_admin' ? 'Every login, configuration change, score submission, correction, approval and publication across the platform.' : 'Recorded activity for the events you manage.'}
      />
      <AuditLogTable events={events} />
    </div>
  );
}
