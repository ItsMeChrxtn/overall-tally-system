import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BadgeCheck, CalendarCheck2, CalendarRange, ClipboardList, Clock3, Gavel, ListChecks, ShieldCheck, Trophy, UserRound, Users } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, PageSkeleton, ProgressBar, StatCard } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import ActivityFeed from '../../components/ActivityFeed';
import { eventTypeLabel, formatDate, titleCase } from '../../lib/format';
import { showError } from '../../lib/alerts';

const STATUS_COLORS = { draft: '#94a3b8', upcoming: '#0ea5e9', active: '#4458d6', scoring: '#8b5cf6', for_verification: '#f59e0b', for_approval: '#f59e0b', published: '#10b981', completed: '#059669', archived: '#cbd5e1' };

function SubmissionsChart({ data }) {
  return (
    <Card>
      <CardHeader title="Score submissions" description="Submitted score sheets over the last 14 days" />
      <div className="h-64 px-2 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -20, right: 12 }}>
            <defs>
              <linearGradient id="sub" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4458d6" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#4458d6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: '#e2e8f0' }} />
            <Area type="monotone" dataKey="submissions" stroke="#4458d6" strokeWidth={2} fill="url(#sub)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ProgressTable({ rows, linkTab = 'monitoring' }) {
  if (!rows?.length) return <EmptyState icon={ListChecks} title="No categories yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Category</th>
            <th>Event</th>
            <th>Scoring</th>
            <th className="w-56">Submissions</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c._id}>
              <td>
                <Link to={`/app/events/${c.event?._id}/${linkTab}`} className="font-medium text-slate-800 hover:text-brand-700">
                  {c.name}
                </Link>
              </td>
              <td className="text-slate-500">{c.event?.name}</td>
              <td>
                <StatusBadge kind="category" status={c.status} />
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <ProgressBar value={c.submitted} max={c.expected} className="flex-1" />
                  <span className="w-14 text-right text-xs text-slate-500 tabular-nums">
                    {c.submitted}/{c.expected}
                  </span>
                </div>
              </td>
              <td>{c.resultStatus ? <StatusBadge kind="result" status={c.resultStatus} /> : <span className="text-xs text-slate-400">None</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApprovalQueue({ items }) {
  if (!items?.length) return null;
  return (
    <Card>
      <CardHeader title="Awaiting approval" description="Results submitted by tabulators" />
      <ul className="divide-y divide-slate-100">
        {items.map((r) => (
          <li key={r._id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-sm font-medium text-slate-800">
                {r.title} <span className="text-slate-400">v{r.version}</span>
              </p>
              <p className="text-xs text-slate-500">{r.event?.name}</p>
            </div>
            <Link to={`/app/events/${r.event?._id}/results/${r._id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
              Review
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SuperAdminDashboard({ d }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total events" value={d.stats.totalEvents} icon={CalendarRange} />
        <StatCard label="Active events" value={d.stats.activeEvents} icon={Clock3} tone="violet" />
        <StatCard label="Completed events" value={d.stats.completedEvents} icon={CalendarCheck2} tone="green" />
        <StatCard label="Results awaiting approval" value={d.stats.pendingApprovals} icon={ShieldCheck} tone="amber" />
        <StatCard label="User accounts" value={d.stats.users} icon={Users} tone="gray" />
        <StatCard label="Judges" value={d.stats.judges} icon={Gavel} tone="blue" />
        <StatCard label="Contestants" value={d.stats.contestants} icon={UserRound} tone="gray" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SubmissionsChart data={d.submissions} />
          <Card>
            <CardHeader title="Events by status" />
            <div className="h-64 px-2 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.eventsByStatus.map((s) => ({ ...s, label: titleCase(s.status) }))} margin={{ left: -20, right: 12 }}>
                  <CartesianGrid stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: '#e2e8f0' }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {d.eventsByStatus.map((s) => (
                      <Cell key={s.status} fill={STATUS_COLORS[s.status] || '#4458d6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Active events" actions={<Link to="/app/events" className="text-xs font-medium text-brand-600">View all</Link>} />
            {d.activeEvents.length ? (
              <ul className="divide-y divide-slate-100">
                {d.activeEvents.map((e) => (
                  <li key={e._id} className="px-5 py-3">
                    <Link to={`/app/events/${e._id}`} className="text-sm font-medium text-slate-800 hover:text-brand-700">
                      {e.name}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <StatusBadge status={e.status} /> {formatDate(e.eventDate)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No active events" />
            )}
          </Card>
          <Card>
            <CardHeader title="Recent activity" actions={<Link to="/app/audit-logs" className="text-xs font-medium text-brand-600">Audit logs</Link>} />
            <ActivityFeed items={d.recentActivity} />
          </Card>
        </div>
      </div>
    </>
  );
}

function EventAdminDashboard({ d }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Assigned events" value={d.stats.assignedEvents} icon={CalendarRange} />
        <StatCard label="Contestants" value={d.stats.contestants} icon={UserRound} tone="gray" />
        <StatCard label="Judge assignments" value={d.stats.judges} icon={Gavel} tone="blue" />
        <StatCard label="Pending submissions" value={d.stats.pendingSubmissions} icon={Clock3} tone="amber" />
        <StatCard label="Completed submissions" value={d.stats.completedSubmissions} icon={BadgeCheck} tone="green" />
        <StatCard label="Awaiting your approval" value={d.stats.awaitingApproval} icon={ShieldCheck} tone="violet" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Scoring progress" description="Submitted vs. expected score sheets per category" />
            <ProgressTable rows={d.progress} />
          </Card>
          <SubmissionsChart data={d.submissions} />
        </div>
        <div className="space-y-6">
          <ApprovalQueue items={d.forApproval} />
          <Card>
            <CardHeader title="Recent event activity" />
            <ActivityFeed items={d.recentActivity} />
          </Card>
        </div>
      </div>
    </>
  );
}

function TabulatorDashboard({ d }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Assigned events" value={d.stats.assignedEvents} icon={CalendarRange} />
        <StatCard label="Pending submissions" value={d.stats.pendingSubmissions} icon={Clock3} tone="amber" />
        <StatCard label="Completed score sheets" value={d.stats.completedSheets} icon={ClipboardList} tone="green" />
        <StatCard label="Awaiting verification" value={d.stats.awaitingVerification} icon={ListChecks} tone="blue" />
        <StatCard label="Awaiting approval" value={d.stats.awaitingApproval} icon={ShieldCheck} tone="violet" />
        <StatCard label="Tabulation progress" value={`${d.stats.tabulationProgress}%`} icon={Trophy} tone="gray" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Tabulation progress" description="Open a category to verify score sheets and generate the tally" />
          <ProgressTable rows={d.progress} linkTab="tally" />
        </Card>
        <div className="space-y-6">
          {d.awaitingVerification.length > 0 && (
            <Alert tone="blue" icon={AlertTriangle} title={`${d.awaitingVerification.length} categor${d.awaitingVerification.length === 1 ? 'y needs' : 'ies need'} verification`}>
              {d.awaitingVerification.map((c) => c.name).join(', ')}
            </Alert>
          )}
          <Card>
            <CardHeader title="Recent activity" />
            <ActivityFeed items={d.recentActivity} />
          </Card>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    api
      .get('/dashboard')
      .then(({ data: d }) => setData(d))
      .catch((err) => showError(err, 'Could not load dashboard'));
  }, []);
  useEffect(load, [load]);

  if (!data) return <PageSkeleton />;
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <PageHeader
        eyebrow={titleCase(user.role)}
        title={`${greeting}, ${user.name.split(' ')[0]}`}
        description={
          user.role === 'super_admin'
            ? 'System-wide overview of every competition on the platform.'
            : user.role === 'event_admin'
              ? 'Configuration, scoring progress and approvals for your events.'
              : 'Score consolidation, verification and official tally preparation.'
        }
        actions={
          data.events?.length ? (
            <div className="hidden gap-2 md:flex">
              {data.events.slice(0, 2).map((e) => (
                <Link key={e._id} to={`/app/events/${e._id}`}>
                  <Badge tone="gray" className="py-1">
                    {e.name} · {eventTypeLabel(e.eventType)}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : null
        }
      />
      {data.role === 'super_admin' && <SuperAdminDashboard d={data} />}
      {data.role === 'event_admin' && <EventAdminDashboard d={data} />}
      {data.role === 'tabulator' && <TabulatorDashboard d={data} />}
    </div>
  );
}
