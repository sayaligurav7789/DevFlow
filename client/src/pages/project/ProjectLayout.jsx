import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useWorkspace } from '../../layouts/WorkspaceScope.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useMembers } from '../../hooks/useMembers.js';
import { projectApi, taskApi } from '../../lib/endpoints.js';
import { Badge, Button, ConfirmDialog, ErrorState, IconButton, Menu, PageHeader, PageLoader } from '../../components/ui/index.js';
import { ProjectDialog } from '../../components/projects/ProjectDialog.jsx';
import { TaskDialog } from '../../components/tasks/TaskDialog.jsx';

const TABS = [['', 'List', true], ['/board', 'Board', false], ['/calendar', 'Calendar', false], ['/timeline', 'Timeline', false], ['/activity', 'Activity', false]];

// Shared shell for a project: header, actions, view tabs (list / board / activity), and the task dialog.
// Child views read what they need from the outlet context and reload when `refreshKey` changes.
export function ProjectLayout() {
  const { projectId } = useParams();
  const { workspace, canManage } = useWorkspace();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { members } = useMembers(workspace.id);

  const [taskDialog, setTaskDialog] = useState({ open: false, task: null, status: 'todo' });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'archive' | 'delete'
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const project = useFetch((signal) => projectApi.get(workspace.id, projectId, { signal }), [workspace.id, projectId]);

  // Deep link from the dashboard or activity feed: /projects/:id?task=123 opens that task once.
  const deepLinkedTask = searchParams.get('task');
  useEffect(() => {
    if (!deepLinkedTask || !project.data) return;
    taskApi.get(projectId, deepLinkedTask)
      .then(({ task }) => setTaskDialog({ open: true, task, status: 'todo' }))
      .catch((e) => toast.error(e.status === 404 ? 'That task no longer exists.' : e.message))
      .finally(() => setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true }));
  }, [deepLinkedTask, project.data?.project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (project.loading && !project.data) return <PageLoader label="Loading project" />;
  if (project.error && !project.data) {
    if (project.error.status === 404 || project.error.status === 400) {
      return (
        <div className="flex flex-col items-center py-20 text-center">
          <p className="text-[13px] font-medium text-faint">404</p>
          <h1 className="mt-1 text-lg font-semibold text-fg">Project not found</h1>
          <p className="mt-1 max-w-sm text-[13px] text-muted">It may have been deleted or moved to another workspace.</p>
          <Button className="mt-5" onClick={() => navigate(`/workspaces/${workspace.id}/projects`)}>Back to projects</Button>
        </div>
      );
    }
    return <ErrorState error={project.error} title="Couldn't load this project" onRetry={project.reload} />;
  }

  const p = project.data.project;
  const projectPath = `/workspaces/${workspace.id}/projects/${p.id}`;
  const openTask = (task) => setTaskDialog({ open: true, task, status: 'todo' });
  const openNewTask = (status = 'todo') => setTaskDialog({ open: true, task: null, status });

  async function runConfirm() {
    setBusy(true); setConfirmError('');
    try {
      if (confirm === 'delete') {
        await projectApi.remove(workspace.id, p.id);
        toast.success('Project deleted');
        navigate(`/workspaces/${workspace.id}/projects`, { replace: true });
        return;
      }
      if (p.archived) { await projectApi.restore(workspace.id, p.id); toast.success('Project restored'); }
      else { await projectApi.archive(workspace.id, p.id); toast.success('Project archived'); }
      setConfirm(null);
      project.reload(); setRefreshKey((k) => k + 1);
    } catch (e) {
      setConfirmError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const menuItems = [
    { key: 'edit', label: 'Edit project', icon: 'edit', onSelect: () => setEditing(true) },
    { key: 'archive', label: p.archived ? 'Restore project' : 'Archive project', icon: 'archive', onSelect: () => setConfirm('archive') },
    { separator: true },
    { key: 'delete', label: 'Delete project', icon: 'trash', danger: true, onSelect: () => setConfirm('delete') },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={<nav aria-label="Breadcrumb"><Link to={`/workspaces/${workspace.id}/projects`} className="hover:text-fg hover:underline">Projects</Link><span aria-hidden="true" className="mx-1.5 text-faint">/</span><span className="text-fg">{p.name}</span></nav>}
        title={p.name}
        description={p.description || undefined}
        actions={(
          <>
            <Button variant="primary" icon="plus" disabled={p.archived} onClick={() => openNewTask()}>New task</Button>
            {canManage && <Menu label="Project actions" align="end" items={menuItems} trigger={<IconButton icon="more" label="Project actions" />} />}
          </>
        )}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-[11.5px]">{p.slug}</code>
          {p.archived && <Badge tone="warning">Archived · read-only</Badge>}
        </div>
      </PageHeader>

      <nav aria-label="Project views" className="-mt-2 mb-5 flex gap-1 border-b border-line">
        {TABS.map(([path, label, end]) => (
          <NavLink
            key={label}
            to={`${projectPath}${path}`}
            end={end}
            className={({ isActive }) => `-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${isActive ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ project: p, members, openTask, openNewTask, refreshKey, user }} />

      <TaskDialog
        open={taskDialog.open}
        onClose={() => setTaskDialog((s) => ({ ...s, open: false }))}
        task={taskDialog.task}
        projectId={p.id}
        projectArchived={p.archived}
        members={members}
        workspaceRole={workspace.role}
        currentUser={user}
        defaultStatus={taskDialog.status}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />
      <ProjectDialog open={editing} onClose={() => setEditing(false)} workspaceId={workspace.id} project={p} onSaved={() => project.reload()} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        busy={busy}
        error={confirmError}
        tone={confirm === 'delete' ? 'danger' : 'primary'}
        title={confirm === 'delete' ? `Delete “${p.name}”?` : p.archived ? 'Restore this project?' : 'Archive this project?'}
        description={confirm === 'delete' ? 'The project and all of its tasks and history will be permanently deleted. This cannot be undone.' : p.archived ? 'Its tasks become editable again.' : 'Tasks become read-only until you restore the project. Nothing is deleted.'}
        confirmLabel={confirm === 'delete' ? 'Delete project' : p.archived ? 'Restore' : 'Archive'}
      />
    </>
  );
}
