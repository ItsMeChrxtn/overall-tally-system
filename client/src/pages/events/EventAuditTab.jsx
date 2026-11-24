import { Navigate, useOutletContext } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AuditLogTable from '../../components/AuditLogTable';
import { Alert } from '../../components/ui';

export default function EventAuditTab() {
  const { event, can } = useOutletContext();
  if (!can.manage) return <Navigate to={`/app/events/${event._id}`} replace />;
  return (
    <div className="space-y-4">
      <Alert tone="gray" icon={ShieldCheck}>
        Audit entries are append-only: they cannot be edited or deleted by anyone, including administrators.
      </Alert>
      <AuditLogTable eventId={event._id} />
    </div>
  );
}
