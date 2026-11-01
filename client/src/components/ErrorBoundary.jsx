import { Component } from 'react';
import { Button } from './ui/index.js';

// Last line of defence: a render crash shows a recoverable screen instead of a blank page.
export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('UI crash:', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 text-center">
        <h1 className="text-xl font-semibold text-fg">Something went wrong</h1>
        <p className="mt-1.5 max-w-sm text-[13.5px] text-muted">An unexpected error occurred while rendering this page. Reloading usually fixes it.</p>
        <Button variant="primary" className="mt-6" onClick={() => window.location.assign('/')}>Reload DevFlow</Button>
      </div>
    );
  }
}
