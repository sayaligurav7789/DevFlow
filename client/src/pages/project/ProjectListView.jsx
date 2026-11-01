import { useOutletContext } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch.js';
import { useListParams } from '../../hooks/useListParams.js';
import { taskApi } from '../../lib/endpoints.js';
import { Button, Card, EmptyState, ErrorState, Pagination, SkeletonRows } from '../../components/ui/index.js';
import { TaskFilterBar, statusParam } from '../../components/tasks/TaskFilters.jsx';
import { TaskTable } from '../../components/tasks/TaskTable.jsx';

const DEFAULTS = { q: '', status: 'all', priority: '', assigneeId: '', sortBy: 'updatedAt', sortOrder: 'desc', page: 1 };

export function ProjectListView() {
  const { project, members, openTask, openNewTask, refreshKey, user } = useOutletContext();
  const { values, set, clear, activeFilterCount } = useListParams(DEFAULTS);
  const tasks = useFetch(
    (signal) => taskApi.list(project.id, {
      q: values.q, status: statusParam(values.status), priority: values.priority || undefined,
      assigneeId: values.assigneeId || undefined, sortBy: values.sortBy, sortOrder: values.sortOrder, page: values.page, limit: 20,
    }, { signal }),
    [project.id, values.q, values.status, values.priority, values.assigneeId, values.sortBy, values.sortOrder, values.page, refreshKey],
  );
  const list = tasks.data?.tasks ?? [];

  return (
    <Card>
      <TaskFilterBar values={values} set={set} onClear={clear} activeFilterCount={activeFilterCount} members={members} currentUserId={user.id} />
      <div aria-busy={tasks.loading} className={tasks.refreshing ? 'opacity-60 transition-opacity' : ''}>
        {tasks.loading && !tasks.data ? <SkeletonRows rows={6} />
          : tasks.error && !tasks.data ? <ErrorState error={tasks.error} title="Couldn't load tasks" onRetry={tasks.reload} />
          : list.length === 0 ? (
            activeFilterCount > 0 ? (
              <EmptyState icon="search" title="No tasks match these filters" description="Adjust or clear your filters to see more tasks." action={<Button onClick={clear}>Clear filters</Button>} />
            ) : (
              <EmptyState
                icon="tasks"
                title="No tasks yet"
                description={project.archived ? 'This archived project has no tasks.' : 'Create the first task to get this project moving.'}
                action={!project.archived && <Button variant="primary" icon="plus" onClick={() => openNewTask()}>New task</Button>}
              />
            )
          ) : (
            <TaskTable tasks={list} currentUserId={user.id} projectArchived={project.archived} onOpen={openTask} onChanged={tasks.reload} />
          )}
      </div>
      {tasks.error && tasks.data && <p role="alert" className="border-t border-line px-4 py-2 text-[12.5px] text-danger">{tasks.error.message}</p>}
      <Pagination pagination={tasks.data?.pagination} onPage={(page) => set({ page })} noun="tasks" disabled={tasks.loading} />
    </Card>
  );
}
