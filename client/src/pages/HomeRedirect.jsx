import { Navigate } from 'react-router-dom';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { ErrorState, PageLoader } from '../components/ui/index.js';

// "/" sends people to their last-used workspace, or to the workspace picker when they have none yet.
export function HomeRedirect() {
  const { current, status, error, refresh } = useWorkspaces();
  if (status === 'loading') return <PageLoader label="Loading your workspace" />;
  if (status === 'error') return <ErrorState error={error} title="Couldn't load your workspaces" onRetry={refresh} />;
  return <Navigate to={current ? `/workspaces/${current.id}` : '/workspaces'} replace />;
}
