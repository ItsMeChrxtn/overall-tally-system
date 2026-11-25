import { Component } from 'react';
import { TriangleAlert } from 'lucide-react';

/** Catches render errors so one broken view never blanks the whole application. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] render error', error, info);
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto my-16 max-w-md rounded-lg border border-red-200 bg-white p-6 text-center">
        <span className="mx-auto mb-3 inline-flex size-11 items-center justify-center rounded-full bg-red-50 text-red-500">
          <TriangleAlert className="size-5" />
        </span>
        <p className="text-sm font-semibold text-ink-900">This page failed to display</p>
        <p className="mt-1 text-sm text-ink-500">{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Reload page
        </button>
      </div>
    );
  }
}
