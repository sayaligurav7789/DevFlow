import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { WorkspaceProvider } from '../context/WorkspaceContext.jsx';
import { PageLoader } from '../components/ui/index.js';

export function RequireAuth() {
  const { user, loading, sessionExpired } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-dvh place-items-center bg-canvas"><PageLoader label="Loading DevFlow" /></div>;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, expired: sessionExpired }} />;
  }
  // Keyed by user so a different account never inherits workspace state.
  return <WorkspaceProvider key={user.id}><Outlet /></WorkspaceProvider>;
}

export function GuestOnly() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas">
        <PageLoader />
      </div>
    );
  }

  if (user) {
    return (
      <Navigate
        to={location.state?.from || '/workspaces'}
        replace
      />
    );
  }

  return <Outlet />;
}