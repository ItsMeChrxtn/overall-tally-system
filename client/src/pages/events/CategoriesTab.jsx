import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Layers, Lock, Plus } from 'lucide-react';
import api from '../../api/client';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Modal, ProgressBar, TableSkeleton } from '../../components/ui';
import StatusBadge from '../../components/StatusBadge';
import { showError, toast } from '../../lib/alerts';
import CategoryForm, { emptyCategory, validateCategory } from './CategoryForm';

export default function CategoriesTab() {
  const { event, can, reload } = useOutletContext();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyCategory());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const editable = can.manage && event.status !== 'archived';

  const load = useCallback(() => {
    api
      .get(`/events/${event._id}/categories`)
      .then(({ data }) => setItems(data.items))
      .catch((err) => {
        setItems([]);
        showError(err);
      });
  }, [event._id]);
  useEffect(load, [load]);

  const create = async () => {
    const e = validateCategory(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/events/${event._id}/categories`, { ...form, customStrategy: form.scoringMethod === 'custom' ? form.customStrategy : null });
      toast.success('Category created');
      setOpen(false);
      reload();
      navigate(`/app/events/${event._id}/categories/${data.category._id}`);
    } catch (err) {
      showError(err, 'Could not create category');
    } finally {
      setSaving(false);
    }
  };

  const overallWeight = (items || []).filter((c) => c.includeInOverall).reduce((a, c) => a + (c.overallWeight || 0), 0);

  return (
    <div className="space-y-4">
      {event.overall?.enabled && items?.length > 0 && event.overall.method === 'weighted' && Math.abs(overallWeight - 100) > 0.0001 && (
        <Alert tone="amber" icon={AlertTriangle} title={`Overall tally weights total ${overallWeight}%`}>
          Included categories must total exactly 100% for the “{event.overall.title}”. Adjust them inside each category.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Competition categories"
          description="Each category has its own criteria, judges, contestants, scoring method and tie-break rules."
          actions={
            editable && (
              <Button
                size="sm"
                icon={Plus}
                onClick={() => {
                  setForm(emptyCategory());
                  setErrors({});
                  setOpen(true);
                }}
              >
                Add category
              </Button>
            )
          }
        />
        {items === null ? (
          <TableSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={Layers} title="No categories yet" description="Add categories like “Best in Talent” or “Dance Category A”, then define their judging criteria." action={editable && <Button icon={Plus} onClick={() => setOpen(true)}>Add category</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Method</th>
                  <th>Criteria</th>
                  <th className="text-center">Judges</th>
                  <th className="text-center">Contestants</th>
                  <th>Scoring</th>
                  <th className="w-44">Submissions</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const weightOk = !['weighted', 'custom'].includes(c.scoringMethod) || Math.abs(c.stats.totalWeight - 100) < 0.0001;
                  return (
                    <tr key={c._id} className="cursor-pointer" onClick={() => navigate(`/app/events/${event._id}/categories/${c._id}`)}>
                      <td>
                        <div className="flex items-center gap-2 font-medium text-ink-800">
                          {c.configLocked && <Lock className="size-3.5 text-ink-400" />}
                          {c.name}
                        </div>
                        {c.includeInOverall && <span className="text-xs text-ink-500">Overall weight {c.overallWeight}%</span>}
                      </td>
                      <td className="text-ink-600">{c.methodLabel}</td>
                      <td>
                        {c.scoringMethod === 'rank' ? (
                          <span className="text-xs text-ink-500">Ranking</span>
                        ) : (
                          <span className="flex items-center gap-2">
                            {c.stats.criteria}
                            <Badge tone={weightOk ? 'green' : 'amber'}>{c.stats.totalWeight}%</Badge>
                          </span>
                        )}
                      </td>
                      <td className="text-center tabular-nums">{c.stats.judges}</td>
                      <td className="text-center tabular-nums">{c.stats.contestants}</td>
                      <td>
                        <StatusBadge kind="category" status={c.status} />
                      </td>
                      <td>
                        {c.stats.expectedSheets ? (
                          <div className="flex items-center gap-2">
                            <ProgressBar value={c.stats.submittedSheets} max={c.stats.expectedSheets} className="flex-1" />
                            <span className="text-xs text-ink-500 tabular-nums">
                              {c.stats.submittedSheets}/{c.stats.expectedSheets}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </td>
                      <td>{c.latestResult ? <StatusBadge kind="result" status={c.latestResult.status} /> : <span className="text-xs text-ink-400">—</span>}</td>
                      <td>
                        <Link to={`/app/events/${event._id}/categories/${c._id}`} onClick={(e) => e.stopPropagation()} className="inline-flex text-ink-400 hover:text-ink-700" aria-label="Open category">
                          <ChevronRight className="size-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add category"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={saving}>
              Create category
            </Button>
          </>
        }
      >
        <CategoryForm value={form} onChange={setForm} errors={errors} />
      </Modal>
    </div>
  );
}
