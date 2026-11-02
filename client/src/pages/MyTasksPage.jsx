import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useWorkspace } from '../layouts/WorkspaceScope.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { useListParams } from '../hooks/useListParams.js';
import { useMembers } from '../hooks/useMembers.js';
import { projectApi, workspaceApi } from '../lib/endpoints.js';
import { Button, Card, EmptyState, ErrorState, Icon, Pagination, SkeletonRows } from '../components/ui/index.js';
import { TaskDialog } from '../components/tasks/TaskDialog.jsx';
import { TaskFilterBar, statusParam } from '../components/tasks/TaskFilters.jsx';
import { TaskTable } from '../components/tasks/TaskTable.jsx';

const DEFAULTS = { q: '', status: 'open', priority: '', projectId: '', sortBy: 'dueAt', sortOrder: 'asc', page: 1 };

export function MyTasksPage() {
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { values, set, clear, activeFilterCount } = useListParams(DEFAULTS);
  const { members } = useMembers(workspace.id);
  const [dialog, setDialog] = useState({ open: false, task: null });

  const projects = useFetch((signal) => projectApi.list(workspace.id, { limit: 100, sortBy: 'name', sortOrder: 'asc' }, { signal }), [workspace.id]);
  const activeProjects = useMemo(() => (projects.data?.projects ?? []).filter((p) => !p.archived), [projects.data]);

  const tasks = useFetch(
    (signal) => workspaceApi.tasks(workspace.id, {
      assigneeId: user.id, q: values.q, status: statusParam(values.status), priority: values.priority || undefined,
      projectId: values.projectId || undefined, sortBy: values.sortBy, sortOrder: values.sortOrder, page: values.page, limit: 20,
    }, { signal }),
    [workspace.id, user.id, values.q, values.status, values.priority, values.projectId, values.sortBy, values.sortOrder, values.page],
  );

  const list = tasks.data?.tasks ?? [];
  const hasProjects = activeProjects.length > 0;

  return (
    <>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Icon name="tasks" className="size-5" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-fg">My tasks</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            Tasks assigned to you in {workspace.name}.
          </p>
        </div>

        <Button
          variant="primary"
          icon="plus"
          disabled={!hasProjects}
          title={hasProjects ? undefined : 'Create a project first'}
          onClick={() => setDialog({ open: true, task: null })}
        >
          New task
        </Button>
      </header>
      <Card>
        <TaskFilterBar values={values} set={set} onClear={clear} activeFilterCount={activeFilterCount} members={members} currentUserId={user.id} assigneeMode="me" projects={projects.data?.projects ?? []} />
        <div aria-busy={tasks.loading} className={tasks.refreshing ? 'opacity-60 transition-opacity' : ''}>
          {tasks.loading && !tasks.data ? <SkeletonRows rows={6} />
            : tasks.error && !tasks.data ? <ErrorState error={tasks.error} title="Couldn't load your tasks" onRetry={tasks.reload} />
            : list.length === 0 ? (
              activeFilterCount > 0 ? (
                <EmptyState icon="search" title="No tasks match these filters" description="Adjust or clear your filters to see more." action={<Button onClick={clear}>Clear filters</Button>} />
              ) : (
                <EmptyState
                  icon="check"
                  title="You're all caught up"
                  description={hasProjects ? 'Nothing open is assigned to you. Create a task, or ask a teammate to assign you one.' : 'There are no projects yet. A workspace owner or admin needs to create one before tasks can be added.'}
                  action={hasProjects && <Button variant="primary" icon="plus" onClick={() => setDialog({ open: true, task: null })}>New task</Button>}
                />
              )
            ) : (
              <TaskTable tasks={list} showProject currentUserId={user.id} onOpen={(task) => setDialog({ open: true, task })} onChanged={tasks.reload} />
            )}
        </div>
        {tasks.error && tasks.data && <p role="alert" className="border-t border-line px-4 py-2 text-[12.5px] text-danger">{tasks.error.message}</p>}
        <Pagination pagination={tasks.data?.pagination} onPage={(page) => set({ page })} noun="tasks" disabled={tasks.loading} />
      </Card>

      <TaskDialog
        open={dialog.open}
        onClose={() => setDialog((s) => ({ ...s, open: false }))}
        task={dialog.task}
        projects={activeProjects}
        members={members}
        workspaceRole={workspace.role}
        currentUser={user}
        defaultAssigneeId={user.id}
        onSaved={() => tasks.reload()}
      />
    </>
  );
}
