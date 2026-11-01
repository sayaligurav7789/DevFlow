import { createContext, useContext, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { Button, ErrorState, PageLoader } from '../components/ui/index.js';
import { isManager } from '../lib/constants.js';

const ScopeContext = createContext(null);

// Resolves :workspaceId against the user's real memberships. Unknown or inaccessible ids
// render a not-found state (the API answers 404 for both).
export function WorkspaceScope() {
  const { workspaceId } = useParams();
  const { workspaces, status, error, refresh, selectWorkspace } = useWorkspaces();
  const navigate = useNavigate();
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  useEffect(() => { if (workspace) selectWorkspace(workspace.id); }, [workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => (workspace ? { workspace, canManage: isManager(workspace.role), isOwner: workspace.role === 'owner' } : null), [workspace]);

  if (status === 'loading') return <PageLoader label="Loading workspace" />;
  if (status === 'error') return <ErrorState error={error} title="Couldn't load your workspaces" onRetry={refresh} />;
  if (!workspace) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <p className="text-[13px] font-medium text-faint">404</p>
        <h1 className="mt-1 text-lg font-semibold text-fg">Workspace not found</h1>
        <p className="mt-1 max-w-sm text-[13px] text-muted">It may have been deleted, or you may not be a member of it.</p>
        <Button className="mt-5" onClick={() => navigate('/workspaces')}>Go to your workspaces</Button>
      </div>
    );
  }
  return <ScopeContext.Provider value={value}><Outlet /></ScopeContext.Provider>;
}

export const useWorkspace = () => useContext(ScopeContext);
