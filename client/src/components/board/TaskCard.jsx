import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { STATUSES, priorityMeta } from '../../lib/constants.js';
import { formatDate, isOverdue } from '../../lib/format.js';
import { Avatar, IconButton, Icon, Label, Menu, PriorityIcon, Spinner } from '../ui/index.js';

// What a card shows: title, priority, assignee, deadline (plus labels). Used by the board and the drag overlay.
export function CardContent({ task, pending = false }) {
  const overdue = isOverdue(task.dueAt, task.status);
  return (
    <>
      <p className={`pr-6 text-[13.5px] font-medium leading-5 ${task.status === 'done' ? 'text-muted' : 'text-fg'}`}>{task.title}</p>
      {task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 2).map((l) => <Label key={l}>{l}</Label>)}
          {task.labels.length > 2 && <span className="text-[11.5px] text-faint">+{task.labels.length - 2}</span>}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5" title={`${priorityMeta(task.priority).label} priority`}>
          <PriorityIcon priority={task.priority} className="size-3.5" />
          <span>{priorityMeta(task.priority).label}</span>
        </span>
        {task.dueAt && (
          <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-danger' : ''}`}>
            <Icon name="calendar" className="size-3.5" />
            {formatDate(task.dueAt)}
            {overdue && <span className="sr-only"> (overdue)</span>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {pending && <span role="status" aria-label="Saving move"><Spinner className="size-3.5 text-faint" /></span>}
          {task.assigneeId
            ? <span title={`Assigned to ${task.assigneeName}`} className="flex"><Avatar name={task.assigneeName} id={task.assigneeId} size="xs" /><span className="sr-only">Assigned to {task.assigneeName}</span></span>
            : <span className="sr-only">Unassigned</span>}
        </span>
      </div>
    </>
  );
}

const CARD = 'rounded-lg border border-line bg-panel p-3 shadow-[0_1px_0_rgb(0_0_0/.02)]';

export function OverlayCard({ task }) {
  return <div className={`${CARD} cursor-grabbing border-accent shadow-pop`}><CardContent task={task} /></div>;
}

export function SortableCard({ task, readOnly, pending, onOpen, onMove }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: readOnly || pending,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const targets = STATUSES.filter((s) => s.value !== task.status);

  return (
    <li ref={setNodeRef} style={style} className={`group relative list-none ${isDragging ? 'opacity-40' : ''}`}>
      {/* The activator is the card itself; the menu button is its sibling so no control is nested inside a button. */}
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-busy={pending || undefined}
        onClick={() => onOpen(task)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onOpen(task); } else listeners?.onKeyDown?.(e);
        }}
        className={`${CARD} block w-full text-left transition-colors hover:border-line-strong ${readOnly || pending ? 'cursor-pointer' : 'cursor-grab'} ${pending ? 'opacity-70' : ''}`}
      >
        <CardContent task={task} pending={pending} />
      </div>
      {!readOnly && (
        <div
          className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Menu
            label={`Move “${task.title}”`}
            align="end"
            width={190}
            items={[{ heading: 'Move to' }, ...targets.map((s) => ({ key: s.value, label: s.label, onSelect: () => onMove(task.id, s.value) }))]}
            trigger={<IconButton icon="more" label={`Move or actions for ${task.title}`} size="sm" disabled={pending} />}
          />
        </div>
      )}
    </li>
  );
}
