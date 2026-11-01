import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { statusMeta } from '../../lib/constants.js';
import { Button, IconButton, StatusIcon } from '../ui/index.js';
import { SortableCard } from './TaskCard.jsx';

export function BoardColumn({ column, readOnly, pending, loadingMore, filtered, onOpen, onMove, onAdd, onLoadMore }) {
  const meta = statusMeta(column.status);
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.status}`, data: { type: 'column' } });
  const remaining = column.total - column.tasks.length;

  return (
    <section
      aria-label={`${meta.label}, ${column.total} ${column.total === 1 ? 'task' : 'tasks'}`}
      className="flex min-w-[16rem] flex-1 shrink-0 snap-start flex-col rounded-xl border border-line bg-sidebar"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <StatusIcon status={column.status} className="size-4" />
        <h2 className="text-[13px] font-semibold text-fg">{meta.label}</h2>
        <span className="rounded-md bg-hover px-1.5 text-[12px] tabular-nums text-muted" aria-hidden="true">{column.total}</span>
        {!readOnly && <IconButton icon="plus" label={`Add task to ${meta.label}`} size="sm" className="ml-auto" onClick={() => onAdd(column.status)} />}
      </header>
      <div
        ref={setNodeRef}
        className={`mx-2 mb-2 min-h-24 flex-1 overflow-y-auto rounded-lg p-1 transition-colors max-h-[calc(100dvh-19rem)] ${isOver ? 'bg-accent-soft' : ''}`}
      >
        <SortableContext items={column.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex min-h-16 flex-col gap-2">
            {column.tasks.map((task) => (
              <SortableCard key={task.id} task={task} readOnly={readOnly} pending={pending.has(task.id)} onOpen={onOpen} onMove={onMove} />
            ))}
          </ul>
        </SortableContext>
        {column.tasks.length === 0 && (
          <p className="px-2 py-6 text-center text-[12.5px] text-faint">{filtered ? 'No matching tasks' : readOnly ? 'No tasks' : 'No tasks — drop one here'}</p>
        )}
        {remaining > 0 && (
          <Button size="sm" variant="ghost" className="mt-2 w-full" loading={loadingMore} onClick={() => onLoadMore(column.status)}>
            Show {Math.min(remaining, 25)} more ({remaining} not shown)
          </Button>
        )}
      </div>
    </section>
  );
}
