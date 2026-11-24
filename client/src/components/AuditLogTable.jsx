import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import api from '../api/client';
import { Badge, Button, Card, EmptyState, Input, SearchInput, Select, TableSkeleton, cx } from './ui';
import { actionLabel } from './ActivityFeed';
import { ROLE_LABELS, formatDateTime } from '../lib/format';
import { showError } from '../lib/alerts';

const TONE = { auth: 'gray', score: 'green', result: 'violet', category: 'brand', criteria: 'brand', event: 'blue', assignment: 'amber', contestant: 'blue', user: 'gray', report: 'gray', settings: 'red' };

function Json({ value }) {
  if (value === undefined || value === null || (typeof value === 'object' && !Object.keys(value).length)) return <span className="text-slate-400">—</span>;
  return <pre className="max-h-56 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(value, null, 2)}</pre>;
}

/** Read-only audit trail viewer. Pass eventId to scope it to one event. */
export default function AuditLogTable({ eventId, events = [] }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    setData(null);
    api
      .get('/audit-logs', { params: { page, limit: 25, q: q || undefined, action: action || undefined, event: eventId || eventFilter || undefined, from: from || undefined, to: to || undefined } })
      .then(({ data: d }) => setData(d))
      .catch((err) => {
        setData({ items: [], total: 0, pages: 1, actions: [] });
        showError(err);
      });
  }, [page, q, action, eventId, eventFilter, from, to]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => setPage(1), [q, action, eventFilter, from, to]);

  const prefixes = [...new Set((data?.actions || []).map((a) => a.split('.')[0]))];

  return (
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-100 px-5 py-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search user, record or action" className="w-full sm:w-64" />
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-full sm:w-44">
          <option value="">All actions</option>
          {prefixes.map((p) => (
            <optgroup key={p} label={p}>
              <option value={`${p}.`}>All {p} actions</option>
              {(data?.actions || [])
                .filter((a) => a.startsWith(`${p}.`))
                .map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
        {!eventId && events.length > 0 && (
          <Select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} className="w-full sm:w-56">
            <option value="">All events</option>
            {events.map((e) => (
              <option key={e._id} value={e._id}>
                {e.name}
              </option>
            ))}
          </Select>
        )}
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" aria-label="To date" />
      </div>
      {!data ? (
        <TableSkeleton rows={8} cols={5} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No log entries match" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-44">Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Affected record</th>
                {!eventId && <th>Event</th>}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <Fragment key={l._id}>
                  <tr className="cursor-pointer" onClick={() => setOpen(open === l._id ? null : l._id)}>
                    <td className="text-xs whitespace-nowrap text-slate-500">{formatDateTime(l.createdAt)}</td>
                    <td>
                      <p className="font-medium text-slate-800">{l.userName || 'System'}</p>
                      <p className="text-xs text-slate-500">{ROLE_LABELS[l.userRole] || ''}</p>
                    </td>
                    <td>
                      <Badge tone={TONE[l.action.split('.')[0]] || 'gray'}>{l.action}</Badge>
                      <p className="mt-0.5 text-xs text-slate-500">{actionLabel(l.action)}</p>
                    </td>
                    <td className="max-w-xs truncate text-slate-600">{l.entityLabel || l.entityType || '—'}</td>
                    {!eventId && <td className="text-xs text-slate-500">{l.event?.name || '—'}</td>}
                    <td>
                      <ChevronDown className={cx('size-4 text-slate-400 transition-transform', open === l._id && 'rotate-180')} />
                    </td>
                  </tr>
                  {open === l._id && (
                    <tr>
                      <td colSpan={eventId ? 5 : 6} className="bg-slate-50/80">
                        <div className="grid gap-4 py-2 md:grid-cols-3">
                          <div>
                            <p className="mb-1 text-xs font-semibold text-slate-500">Previous value</p>
                            <Json value={l.before} />
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold text-slate-500">New value</p>
                            <Json value={l.after} />
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold text-slate-500">Details</p>
                            <Json value={{ ...(l.meta || {}), entityType: l.entityType, entityId: l.entityId, ip: l.ip }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
          <span>
            {data.total} entries · page {data.page} of {data.pages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
