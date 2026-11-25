import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../../api/client';
import { EmptyState, PageSkeleton } from '../../components/ui';

/**
 * Old per-category link (still used by notifications). Judges now score every assigned
 * category of an event on one sheet, so this just forwards to that sheet.
 */
export default function ScoringPage() {
  const { categoryId } = useParams();
  const [eventId, setEventId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/judging/categories/${categoryId}`)
      .then(({ data }) => setEventId(data.event._id))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [categoryId]);

  if (error) return <EmptyState title="Unable to open this category" description={error} action={<Link to="/app/judging" className="text-sm font-medium text-brand-700">Back to my assignments</Link>} />;
  if (!eventId) return <PageSkeleton />;
  return <Navigate to={`/app/judging/event/${eventId}?category=${categoryId}`} replace />;
}
