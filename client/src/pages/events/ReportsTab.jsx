import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { ClipboardList, FileBarChart, FileSpreadsheet, FileText, Gavel, ListOrdered, Printer, ScrollText, Sheet, Trophy, UserRound } from 'lucide-react';
import api from '../../api/client';
import { Badge, Button, Card, CardHeader, Field, Input, Select, cx } from '../../components/ui';
import { showError } from '../../lib/alerts';
import { exportExcel, exportPdf, fetchReport, printReport } from '../../lib/reportExport';

const TYPES = [
  { key: 'tally', label: 'Overall Tally Sheet', icon: Sheet, needs: ['category'], desc: 'Every judge’s score, criterion averages, final score and rank.' },
  { key: 'judge_sheet', label: 'Individual Judge Score Sheet', icon: Gavel, needs: ['category', 'judge?'], desc: 'Each judge’s raw criterion scores with signature lines.' },
  { key: 'contestant_breakdown', label: 'Contestant Score Breakdown', icon: UserRound, needs: ['category', 'contestant?'], desc: 'Criterion × judge breakdown for each contestant.' },
  { key: 'category_ranking', label: 'Category Ranking', icon: ListOrdered, needs: ['category'], desc: 'Clean ranking list for announcement.' },
  { key: 'final_results', label: 'Final Results', icon: Trophy, needs: [], desc: 'All approved / published results of the event.' },
  { key: 'judge_submission', label: 'Judge Submission Report', icon: ClipboardList, needs: [], desc: 'Submitted, draft and missing sheets per judge.' },
  { key: 'event_summary', label: 'Event Summary Report', icon: FileBarChart, needs: [], desc: 'Event details, categories, criteria, officials and contestants.' },
  { key: 'audit_trail', label: 'Audit Trail Report', icon: ScrollText, needs: ['dates?'], manage: true, desc: 'Chronological log of every recorded action.' },
];

export default function ReportsTab() {
  const { event, can } = useOutletContext();
  const [params] = useSearchParams();
  const [type, setType] = useState('tally');
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState(params.get('category') || '');
  const [detail, setDetail] = useState(null);
  const [judge, setJudge] = useState('');
  const [contestant, setContestant] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);

  const types = TYPES.filter((t) => !t.manage || can.manage);
  const def = TYPES.find((t) => t.key === type);
  const needsCategory = def.needs.includes('category');

  useEffect(() => {
    api.get(`/events/${event._id}/categories`).then(({ data }) => {
      setCategories(data.items);
      if (!category && data.items.length) setCategory(data.items[0]._id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event._id]);

  useEffect(() => {
    if (!category) return;
    api.get(`/categories/${category}/sheets`).then(({ data }) => setDetail(data.config)).catch(() => setDetail(null));
    setJudge('');
    setContestant('');
  }, [category]);

  const query = useMemo(() => {
    const q = {};
    if (needsCategory) q.category = category;
    if (def.needs.includes('judge?') && judge) q.judge = judge;
    if (def.needs.includes('contestant?') && contestant) q.contestant = contestant;
    if (def.needs.includes('dates?')) {
      if (from) q.from = from;
      if (to) q.to = to;
    }
    return q;
  }, [needsCategory, category, judge, contestant, from, to, def]);

  useEffect(() => setPreview(null), [type, query]);

  const run = async (kind) => {
    if (needsCategory && !category) return;
    setBusy(kind);
    try {
      if (kind === 'pdf') await exportPdf(event._id, type, query);
      else if (kind === 'xlsx') await exportExcel(event._id, type, query);
      else if (kind === 'print') await printReport(event._id, type, query);
      else setPreview(await fetchReport(event._id, type, query));
    } catch (err) {
      showError(err, 'Report failed');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
      <Card className="h-fit">
        <CardHeader title="Report type" />
        <ul className="p-2">
          {types.map((t) => (
            <li key={t.key}>
              <button type="button" onClick={() => setType(t.key)} className={cx('flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors', type === t.key ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                <t.icon className={cx('mt-0.5 size-4 shrink-0', type === t.key ? 'text-brand-600' : 'text-slate-400')} />
                <span>
                  <span className={cx('block text-sm font-medium', type === t.key ? 'text-brand-700' : 'text-slate-800')}>{t.label}</span>
                  <span className="block text-xs text-slate-500">{t.desc}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title={def.label} description="Reports include event information, scoring criteria, computed scores and prepared / verified / approved by fields." />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {needsCategory && (
              <Field label="Category" required>
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {def.needs.includes('judge?') && (
              <Field label="Judge">
                <Select value={judge} onChange={(e) => setJudge(e.target.value)}>
                  <option value="">All judges (one sheet each)</option>
                  {detail?.judges.map((j) => (
                    <option key={j.userId} value={j.userId}>
                      {j.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {def.needs.includes('contestant?') && (
              <Field label="Contestant">
                <Select value={contestant} onChange={(e) => setContestant(e.target.value)}>
                  <option value="">All contestants</option>
                  {detail?.contestants.map((c) => (
                    <option key={c.contestantId} value={c.contestantId}>
                      #{c.number} {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {def.needs.includes('dates?') && (
              <>
                <Field label="From">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To">
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </>
            )}
            {needsCategory && <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">Uses the latest saved result version for the category; if none exists, a live preliminary computation is shown and clearly labelled.</p>}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <Button icon={FileText} loading={busy === 'pdf'} onClick={() => run('pdf')} disabled={needsCategory && !category}>
              Download PDF
            </Button>
            <Button variant="secondary" icon={FileSpreadsheet} loading={busy === 'xlsx'} onClick={() => run('xlsx')} disabled={needsCategory && !category}>
              Download Excel
            </Button>
            <Button variant="secondary" icon={Printer} loading={busy === 'print'} onClick={() => run('print')} disabled={needsCategory && !category}>
              Printable HTML
            </Button>
            <Button variant="ghost" loading={busy === 'preview'} onClick={() => run('preview')} disabled={needsCategory && !category}>
              Preview here
            </Button>
          </div>
        </Card>

        {preview && (
          <Card>
            <div className="border-b border-slate-100 px-5 py-4 text-center">
              {preview.organization && <p className="text-xs text-slate-500">{preview.organization}</p>}
              <p className="text-base font-semibold text-slate-900">{preview.event.name}</p>
              <p className="text-sm font-medium text-slate-700">
                {preview.title}
                {preview.subtitle && ` — ${preview.subtitle}`}
              </p>
              <p className="text-xs text-slate-500">
                {preview.event.date} · {preview.event.venue}
              </p>
              {preview.statusLabel && <Badge tone="brand" className="mt-2">{preview.statusLabel}</Badge>}
            </div>
            <div className="space-y-6 p-5">
              {preview.sections.map((s, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold text-slate-900">{s.heading}</p>
                  {s.note && <p className="mb-2 text-xs text-slate-500 italic">{s.note}</p>}
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                    {s.keyValues ? (
                      <table className="table-base">
                        <tbody>
                          {s.keyValues.map(([k, v]) => (
                            <tr key={k}>
                              <td className="w-48 font-medium text-slate-600">{k}</td>
                              <td>{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="table-base">
                        <thead>
                          <tr>
                            {s.columns.map((c) => (
                              <th key={c.key} className={c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}>
                                {c.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {s.rows.map((r, k) => (
                            <tr key={k} className={r._bold ? 'font-semibold' : ''}>
                              {s.columns.map((c) => (
                                <td key={c.key} className={cx('tabular-nums', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '')}>
                                  {r[c.key]}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ))}
              {preview.signatories?.length > 0 && (
                <div className="grid gap-6 pt-6 sm:grid-cols-3">
                  {preview.signatories.map((s, i) => (
                    <div key={i}>
                      <p className="text-xs text-slate-500">{s.label}</p>
                      <p className="mt-6 border-b border-slate-400 pb-1 text-sm font-semibold">{s.name || ' '}</p>
                      <p className="text-xs text-slate-500">{s.role}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
