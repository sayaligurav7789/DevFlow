import { Link } from 'react-router-dom';
import { Button } from '../components/ui/index.js';

export function NotFoundPage({ standalone = false }) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 text-center ${standalone ? 'min-h-dvh bg-canvas' : 'py-24'}`}>
      <p className="text-[13px] font-medium text-faint">404</p>
      <h1 className="mt-1 text-xl font-semibold text-fg">Page not found</h1>
      <p className="mt-1.5 max-w-sm text-[13.5px] text-muted">The page you’re looking for doesn’t exist or has moved.</p>
      <Link to="/" className="mt-6"><Button variant="primary">Back to DevFlow</Button></Link>
    </div>
  );
}
