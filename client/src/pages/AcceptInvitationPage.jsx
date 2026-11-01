import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { invitationApi } from '../lib/endpoints.js';
import { Button, Card, EmptyState, Notice } from '../components/ui/index.js';

// Joining is an explicit click (never automatic on page load) so link previews,
// double-mounted effects, or the wrong signed-in account can't consume an invitation.
export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { user, logout } = useAuth();
  const { refresh, selectWorkspace } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function accept() {
    setBusy(true); setError(null);
    try {
      const { workspace } = await invitationApi.accept(token);
      await refresh();
      selectWorkspace(workspace.id);
      toast.success(`You joined ${workspace.name}`);
      navigate(`/workspaces/${workspace.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  async function switchAccount() {
    await logout();
    navigate('/login', { replace: true, state: { from: `/invitations/accept?token=${encodeURIComponent(token)}` } });
  }

  if (!token) {
    return (
      <Card className="mx-auto mt-10 max-w-md">
        <EmptyState icon="mail" title="Invitation link is incomplete" description="Open the full link you were sent, or ask a workspace admin for a new invitation." action={<Link to="/workspaces"><Button>Go to workspaces</Button></Link>} />
      </Card>
    );
  }

  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center">
      <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.500 4h11v8h-11zM2.500 4.500 8 9l5.500-4.500" /></svg>
      </div>
      <h1 className="text-lg font-semibold text-fg">You’ve been invited to a workspace</h1>
      <p className="mt-1.5 text-[13px] text-muted">You’re signed in as <span className="font-medium text-fg">{user.email}</span>. The invitation must have been sent to this address.</p>
      {error && (
        <Notice tone="error" className="mt-4 text-left">
          {error.message}
        </Notice>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" size="lg" loading={busy} onClick={accept}>Join workspace</Button>
        {error?.status === 403 && <Button variant="ghost" onClick={switchAccount}>Sign in with a different account</Button>}
        {error?.status === 409 && <Link to="/workspaces"><Button className="w-full">Go to your workspaces</Button></Link>}
      </div>
    </Card>
  );
}
