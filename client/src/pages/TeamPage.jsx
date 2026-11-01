import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { useWorkspace } from '../layouts/WorkspaceScope.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { workspaceApi } from '../lib/endpoints.js';
import { ROLE_LABELS } from '../lib/constants.js';
import { formatDate } from '../lib/format.js';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, FilterSelect, IconButton, Menu, PageHeader, SkeletonRows } from '../components/ui/index.js';
import { InviteDialog } from '../components/InviteDialog.jsx';

const STATUS_TONE = { pending: 'accent', accepted: 'success', revoked: 'neutral', expired: 'warning' };

export function TeamPage() {
  const { workspace, canManage, isOwner } = useWorkspace();
  const { user } = useAuth();
  const { refresh } = useWorkspaces();
  const toast = useToast();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const [removal, setRemoval] = useState(null); // member being removed / left
  const [busy, setBusy] = useState(false);
  const [removalError, setRemovalError] = useState('');

  const members = useFetch((signal) => workspaceApi.members(workspace.id, { signal }), [workspace.id]);
  const invitations = useFetch((signal) => workspaceApi.invitations(workspace.id, { signal }), [workspace.id], { enabled: canManage });
  const canInvite = canManage || workspace.settings?.allowMemberInvites === true;

  async function changeRole(member, role) {
    try {
      await workspaceApi.updateMemberRole(workspace.id, member.id, role);
      toast.success(`${member.displayName} is now ${ROLE_LABELS[role]}`);
    } catch (e) { toast.error(e.message); }
    members.reload();
  }

  async function confirmRemoval() {
    setBusy(true); setRemovalError('');
    try {
      await workspaceApi.removeMember(workspace.id, removal.id);
      if (removal.id === user.id) {
        toast.success(`You left ${workspace.name}`);
        const remaining = await refresh();
        navigate(remaining.length ? `/workspaces/${remaining[0].id}` : '/workspaces', { replace: true });
        return;
      }
      toast.success(`${removal.displayName} removed`);
      setRemoval(null);
      members.reload();
      refresh();
    } catch (e) {
      setRemovalError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation) {
    try {
      await workspaceApi.revokeInvitation(workspace.id, invitation.id);
      toast.success(`Invitation to ${invitation.email} revoked`);
      invitations.reload();
    } catch (e) { toast.error(e.message); invitations.reload(); }
  }

  const list = members.data?.members ?? [];
  const canRemove = (m) => m.role !== 'owner' && (isOwner || (workspace.role === 'admin' && m.role === 'member') || m.id === user.id);

  return (
    <>
      <PageHeader
        title="Team"
        description={`People in ${workspace.name} and their roles.`}
        actions={canInvite && <Button variant="primary" icon="mail" onClick={() => setInviting(true)}>Invite people</Button>}
      />

      <Card>
        <CardHeader title="Members" description={members.data ? `${list.length} ${list.length === 1 ? 'person' : 'people'}` : undefined} />
        {members.loading && !members.data ? <SkeletonRows rows={4} />
          : members.error && !members.data ? <ErrorState error={members.error} title="Couldn't load members" onRetry={members.reload} />
          : (
            <ul className="divide-y divide-line">
              {list.map((m) => {
                const self = m.id === user.id;
                const actions = [];
                if (canRemove(m)) actions.push({ key: 'remove', label: self ? 'Leave workspace' : 'Remove from workspace', icon: self ? 'logout' : 'trash', danger: true, onSelect: () => { setRemoval(m); setRemovalError(''); } });
                return (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={m.displayName} id={m.id} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-fg">{m.displayName}{self && <span className="ml-1.5 text-[12px] font-normal text-faint">(you)</span>}</p>
                      <p className="truncate text-[12.5px] text-muted">{m.email}</p>
                    </div>
                    <span className="hidden text-[12.5px] text-faint md:block">Joined {formatDate(m.joinedAt)}</span>
                    {isOwner && m.role !== 'owner' ? (
                      <FilterSelect label={`Role for ${m.displayName}`} value={m.role} onChange={(role) => changeRole(m, role)} className="w-28">
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </FilterSelect>
                    ) : <Badge tone={m.role === 'owner' ? 'accent' : 'neutral'} className="w-16 justify-center">{ROLE_LABELS[m.role]}</Badge>}
                    <div className="w-8">
                      {actions.length > 0 && <Menu label={`Actions for ${m.displayName}`} align="end" items={actions} trigger={<IconButton icon="more" label={`Actions for ${m.displayName}`} />} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </Card>

      {canManage && (
        <Card className="mt-6">
          <CardHeader title="Invitations" description="Pending and past invitations to this workspace." />
          {invitations.loading && !invitations.data ? <SkeletonRows rows={2} />
            : invitations.error && !invitations.data ? <ErrorState error={invitations.error} title="Couldn't load invitations" onRetry={invitations.reload} />
            : (invitations.data?.invitations ?? []).length === 0 ? (
              <EmptyState icon="mail" title="No invitations yet" description="Invite teammates by email to give them access." action={<Button icon="mail" onClick={() => setInviting(true)}>Invite people</Button>} />
            ) : (
              <ul className="divide-y divide-line">
                {invitations.data.invitations.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] text-fg">{i.email}</p>
                      <p className="truncate text-[12.5px] text-muted">{ROLE_LABELS[i.role]} · invited by {i.invitedBy ?? 'a former member'} · expires {formatDate(i.expiresAt)}</p>
                    </div>
                    <Badge tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status[0].toUpperCase() + i.status.slice(1)}</Badge>
                    {i.status === 'pending' ? <Button size="sm" variant="danger-ghost" onClick={() => revoke(i)} aria-label={`Revoke invitation for ${i.email}`}>Revoke</Button> : <span className="w-[58px]" />}
                  </li>
                ))}
              </ul>
            )}
        </Card>
      )}

      <InviteDialog open={inviting} onClose={() => setInviting(false)} workspaceId={workspace.id} isOwner={isOwner} onInvited={() => canManage && invitations.reload()} />
      <ConfirmDialog
        open={removal !== null}
        onClose={() => setRemoval(null)}
        onConfirm={confirmRemoval}
        busy={busy}
        error={removalError}
        title={removal?.id === user.id ? `Leave ${workspace.name}?` : `Remove ${removal?.displayName}?`}
        description={removal?.id === user.id ? 'You will lose access to its projects and tasks until someone invites you again.' : 'They will lose access to this workspace. Their tasks stay in place.'}
        confirmLabel={removal?.id === user.id ? 'Leave workspace' : 'Remove member'}
      />
    </>
  );
}
