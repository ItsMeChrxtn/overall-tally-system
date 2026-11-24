import { useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import api from '../../api/client';
import { Badge, Card, EmptyState, PageHeader, SearchInput, TableSkeleton } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { formatDateTime, num } from '../../lib/format';
import { showError } from '../../lib/alerts';

export default function JudgeHistoryPage() {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api
      .get('/judging/history')
      .then(({ data }) => setItems(data.items))
      .catch((err) => {
        setItems([]);
        showError(err);
      });
  }, []);
  const filtered = useMemo(() => (items || []).filter((s) => !q || `${s.event.name} ${s.category?.name} ${s.contestant?.name}`.toLowerCase().includes(q.toLowerCase())), [items, q]);

  return (
    <div>
      <PageHeader title="Submission history" description="Your submitted score sheets. Scores are visible only where the event organizer allows it." />
      <Card>
        <div className="border-b border-slate-100 px-5 py-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search event, category or contestant" className="w-full sm:w-80" />
        </div>
        {items === null ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState icon={History} title="No submitted sheets yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Event</th>
                  <th>Category</th>
                  <th>Contestant</th>
                  <th>Status</th>
                  <th className="text-right">Your score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s._id}>
                    <td className="text-xs whitespace-nowrap text-slate-500">{formatDateTime(s.submittedAt)}</td>
                    <td className="text-slate-700">{s.event.name}</td>
                    <td>{s.category?.name}</td>
                    <td>
                      #{s.contestant?.number} {s.contestant?.name}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <StatusBadge kind="sheet" status={s.status} />
                        {s.submissionCount > 1 && <Badge>resubmitted</Badge>}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">
                      {!s.scoresVisible ? <span className="text-xs text-slate-400">Hidden by organizer</span> : s.rank ? `Rank ${s.rank}` : `${num(s.computedWeighted)} (total ${num(s.computedTotal)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
