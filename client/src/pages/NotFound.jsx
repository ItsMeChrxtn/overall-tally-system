import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui';

export default function NotFound({ inApp }) {
  return (
    <div className={inApp ? 'py-16' : 'flex min-h-screen items-center justify-center'}>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist or you do not have access to it."
        action={
          <Link to={inApp ? '/app' : '/'} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Go back home
          </Link>
        }
      />
    </div>
  );
}
