import { useOutletContext } from 'react-router-dom';
import { useToast } from '../../context/ToastContext.jsx';
import { useBoard } from '../../hooks/useBoard.js';
import { useListParams } from '../../hooks/useListParams.js';
import { PRIORITIES } from '../../lib/constants.js';
import { KanbanBoard } from '../../components/board/KanbanBoard.jsx';
import { Button, ErrorState, FilterSelect, Notice, SearchInput, Skeleton } from '../../components/ui/index.js';

const DEFAULTS = { q: '', priority: '', assigneeId: '' };

function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading board" className="flex gap-3 overflow-hidden">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="min-w-[16rem] flex-1 shrink-0 rounded-xl border border-line bg-sidebar p-3">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
      <span className="sr-only">Loading board</span>
    </div>
  );
}

export function ProjectBoardView() {
  const { project, members, openTask, openNewTask, refreshKey, user } = useOutletContext();
  const toast = useToast();
  const { values, set, clear, activeFilterCount } = useListParams(DEFAULTS);
  const filters = { q: values.q, priority: values.priority, assigneeId: values.assigneeId };
  const board = useBoard({
    projectId: project.id,
    filters,
    refreshKey,
    onMoveError: (error) => toast.error(error.message || 'Could not save that change. The card was put back.'),
  });
  const readOnly = project.archived || board.archived;

  return (
    <>
      <div role="search" aria-label="Filter the board" className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={values.q} onChange={(q) => set({ q })} placeholder="Search tasks" label="Search the board" className="w-full sm:w-56" />
        <FilterSelect label="Filter by priority" value={values.priority} onChange={(v) => set({ priority: v })}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </FilterSelect>
        <FilterSelect label="Filter by assignee" value={values.assigneeId} onChange={(v) => set({ assigneeId: v })}>
          <option value="">Anyone</option>
          <option value={user.id}>Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {members.filter((m) => m.id !== user.id).map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </FilterSelect>
        {activeFilterCount > 0 && <Button size="sm" variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>

      {readOnly && <Notice tone="warning" className="mb-4">This project is archived, so cards can’t be moved. Restore it to edit the board.</Notice>}

      {board.loading && !board.columns ? <BoardSkeleton />
        : board.error && !board.columns ? <ErrorState error={board.error} title="Couldn’t load the board" onRetry={board.reload} />
        : (
          <div aria-busy={board.loading} className={board.loading ? 'opacity-60 transition-opacity' : ''}>
            {board.error && <Notice tone="error" className="mb-4">{board.error.message}</Notice>}
            <KanbanBoard board={board} readOnly={readOnly} filtered={activeFilterCount > 0} onOpen={openTask} onAdd={openNewTask} />
          </div>
        )}
    </>
  );
}
