import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BadgeCheck, CalendarCheck2, CalendarRange, ClipboardList, Clock3, Gavel, ListChecks, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, PageSkeleton, ProgressBar, StatCard, StatGroup } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import ActivityFeed from '../../components/ActivityFeed';
import { eventTypeLabel, formatDate, titleCase } from '../../lib/format';
import { showError } from '../../lib/alerts';

const STATUS_COLORS = { draft: "#d2d7e3", upcoming: "#8aa0ea", active: "#3359db", scoring: "#2447c7", for_verification: "#ffc72c", for_approval: "#f5b100", published: "#172a6b", completed: "#0f1d4f", archived: "#e5e8f0" };
const AXIS = { fontSize: 11, fill: "#8790a8" };
const TOOLTIP = { borderRadius: 12, fontSize: 12, borderColor: "#e5e8f0", boxShadow: "0 6px 16px -6px #0e163029" };

function SubmissionsChart({ data }) {
  return (
    <Card>
      <CardHeader title="Score submissions" description="Submitted score sheets over the last 14 days" />
      <div className="h-64 px-2 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: -20, right: 12 }}>
            <defs>
              <linearGradient id="sub" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2447c7" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#2447c7" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#edf0f7" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP} />
            <Area type="monotone" dataKey="submissions" stroke="#2447c7" strokeWidth={2.25} fill="url(#sub)" />
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
                <Link to={`/app/events/${c.event?._id}/${linkTab}`} className="font-medium text-ink-800 hover:text-brand-700">
                  {c.name}
                </Link>
              </td>
              <td className="text-ink-500">{c.event?.name}</td>
              <td>
                <StatusBadge kind="category" status={c.status} />
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <ProgressBar value={c.submitted} max={c.expected} className="flex-1" />
                  <span className="w-14 text-right text-xs text-ink-500 tabular-nums">
                    {c.submitted}/{c.expected}
                  </span>
                </div>
              </td>
              <td>{c.resultStatus ? <StatusBadge kind="result" status={c.resultStatus} /> : <span className="text-xs text-ink-400">None</span>}</td>
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
      <ul className="divide-y divide-ink-100">
        {items.map((r) => (
          <li key={r._id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-sm font-medium text-ink-800">
                {r.title} <span className="text-ink-400">v{r.version}</span>
              </p>
              <p className="text-xs text-ink-500">{r.event?.name}</p>
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
      <StatGroup className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total events" value={d.stats.totalEvents} icon={CalendarRange} />
        <StatCard label="Active events" value={d.stats.activeEvents} icon={Clock3} tone="brand" />
        <StatCard label="Completed events" value={d.stats.completedEvents} icon={CalendarCheck2} tone="green" />
        <StatCard label="Judges" value={d.stats.judges} icon={Gavel} tone="blue" />
        <StatCard label="Contestants" value={d.stats.contestants} icon={UserRound} tone="gray" />
      </StatGroup>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SubmissionsChart data={d.submissions} />
          <Card>
            <CardHeader title="Events by status" />
            <div className="h-64 px-2 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.eventsByStatus.map((s) => ({ ...s, label: titleCase(s.status) }))} margin={{ left: -20, right: 12 }}>
                  <CartesianGrid stroke="#edf0f7" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "#f3f5fa" }} contentStyle={TOOLTIP} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={40}>
                    {d.eventsByStatus.map((s) => (
                      <Cell key={s.status} fill={STATUS_COLORS[s.status] || "#2447c7"} />
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
              <ul className="divide-y divide-ink-100">
                {d.activeEvents.map((e) => (
                  <li key={e._id} className="px-5 py-3">
                    <Link to={`/app/events/${e._id}`} className="text-sm font-medium text-ink-800 hover:text-brand-700">
                      {e.name}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
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
      <StatGroup className="grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Assigned events" value={d.stats.assignedEvents} icon={CalendarRange} />
        <StatCard label="Contestants" value={d.stats.contestants} icon={UserRound} tone="gray" />
        <StatCard label="Judge assignments" value={d.stats.judges} icon={Gavel} tone="blue" />
        <StatCard label="Pending submissions" value={d.stats.pendingSubmissions} icon={Clock3} tone="amber" />
        <StatCard label="Completed submissions" value={d.stats.completedSubmissions} icon={BadgeCheck} tone="green" />
        <StatCard label="Awaiting your approval" value={d.stats.awaitingApproval} icon={ShieldCheck} tone="brand" />
      </StatGroup>
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
      <StatGroup className="grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Assigned events" value={d.stats.assignedEvents} icon={CalendarRange} />
        <StatCard label="Pending submissions" value={d.stats.pendingSubmissions} icon={Clock3} tone="amber" />
        <StatCard label="Completed score sheets" value={d.stats.completedSheets} icon={ClipboardList} tone="green" />
        <StatCard label="Awaiting verification" value={d.stats.awaitingVerification} icon={ListChecks} tone="blue" />
        <StatCard label="Awaiting approval" value={d.stats.awaitingApproval} icon={ShieldCheck} tone="brand" />
        <StatCard label="Tabulation progress" value={`${d.stats.tabulationProgress}%`} icon={Trophy} tone="gray" />
      </StatGroup>
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

  return (
    <div>
      <PageHeader
        eyebrow={user.name}
        title={user.role === "super_admin" ? "All competitions" : user.role === "event_admin" ? "Your events" : "Tabulation desk"}
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
