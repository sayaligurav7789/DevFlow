import { PRIORITIES, STATUSES, priorityMeta, statusMeta } from '../../lib/constants.js';
import { formatDate, isOverdue } from '../../lib/format.js';
import { taskApi } from '../../lib/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Avatar, Icon, Label, Menu, PriorityIcon, StatusIcon } from '../ui/index.js';

function QuickStatus({ task, disabled, onChanged }) {
  const toast = useToast();
  async function change(status) {
    if (status === task.status) return;
    try { await taskApi.update(task.projectId, task.id, { status }); toast.success(`Moved to ${statusMeta(status).label}`); onChanged(); }
    catch (e) { toast.error(e.message); }
  }
  const trigger = (
    <button type="button" disabled={disabled} aria-label={`Status: ${statusMeta(task.status).label}. Change status`} className="flex size-7 items-center justify-center rounded-md hover:bg-hover disabled:hover:bg-transparent">
      <StatusIcon status={task.status} className="size-4" />
    </button>
  );
  if (disabled) return trigger;
  return <Menu label="Set status" width={180} trigger={trigger} items={STATUSES.map((s) => ({ key: s.value, label: s.label, checked: s.value === task.status, onSelect: () => change(s.value) }))} />;
}

function QuickPriority({ task, disabled, onChanged }) {
  const toast = useToast();
  async function change(priority) {
    if (priority === task.priority) return;
    try { await taskApi.update(task.projectId, task.id, { priority }); toast.success(`Priority set to ${priorityMeta(priority).label}`); onChanged(); }
    catch (e) { toast.error(e.message); }
  }
  const trigger = (
    <button type="button" disabled={disabled} aria-label={`Priority: ${priorityMeta(task.priority).label}. Change priority`} className="flex size-7 items-center justify-center rounded-md hover:bg-hover disabled:hover:bg-transparent">
      <PriorityIcon priority={task.priority} className="size-4" />
    </button>
  );
  if (disabled) return trigger;
  return <Menu label="Set priority" width={180} trigger={trigger} items={PRIORITIES.map((p) => ({ key: p.value, label: p.label, checked: p.value === task.priority, onSelect: () => change(p.value) }))} />;
}

export function TaskTable({ tasks, onOpen, onChanged, showProject = false, projectArchived = false, currentUserId }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <caption className="sr-only">Tasks</caption>
        <thead>
          <tr className="border-b border-line text-[11.5px] font-medium uppercase tracking-wide text-faint">
            <th scope="col" className="w-20 py-2 pl-3 pr-1 font-medium"><span className="sr-only">Status and priority</span></th>
            <th scope="col" className="px-2 py-2 font-medium">Title</th>
            {showProject && <th scope="col" className="hidden px-2 py-2 font-medium lg:table-cell">Project</th>}
            <th scope="col" className="hidden px-2 py-2 font-medium md:table-cell">Assignee</th>
            <th scope="col" className="hidden px-2 py-2 font-medium sm:table-cell">Due</th>
            <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tasks.map((task) => {
            const readOnly = projectArchived || task.projectArchived;
            const overdue = isOverdue(task.dueAt, task.status);
            return (
              <tr key={task.id} className="group hover:bg-raised">
                <td className="py-1.5 pl-3 pr-1">
                  <div className="flex items-center">
                    <QuickStatus task={task} disabled={readOnly} onChanged={onChanged} />
                    <QuickPriority task={task} disabled={readOnly} onChanged={onChanged} />
                  </div>
                </td>
                <td className="max-w-0 px-2 py-2">
                  <button type="button" onClick={() => onOpen(task)} className="block w-full min-w-0 rounded text-left">
                    <span className={`block truncate text-[13.5px] font-medium ${task.status === 'done' ? 'text-muted line-through decoration-faint' : 'text-fg'}`}>{task.title}</span>
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    <span className="sm:hidden">{statusMeta(task.status).label}</span>
                    {showProject && <span className="truncate lg:hidden">{task.projectName}</span>}
                    {task.dueAt && <span className={`sm:hidden ${overdue ? 'text-danger' : ''}`}>Due {formatDate(task.dueAt)}</span>}
                    {task.labels.slice(0, 3).map((l) => <Label key={l}>{l}</Label>)}
                    {task.labels.length > 3 && <span className="text-faint">+{task.labels.length - 3}</span>}
                  </div>
                </td>
                {showProject && <td className="hidden max-w-[180px] truncate px-2 py-2 text-[13px] text-muted lg:table-cell">{task.projectName}</td>}
                <td className="hidden px-2 py-2 md:table-cell">
                  {task.assigneeId ? (
                    <span className="flex items-center gap-2 text-[13px] text-fg">
                      <Avatar name={task.assigneeName} id={task.assigneeId} size="xs" />
                      <span className="max-w-[120px] truncate">{task.assigneeId === currentUserId ? 'You' : task.assigneeName}</span>
                    </span>
                  ) : <span className="text-[13px] text-faint">Unassigned</span>}
                </td>
                <td className="hidden whitespace-nowrap px-2 py-2 text-[13px] sm:table-cell">
                  {task.dueAt ? (
                    <span className={`inline-flex items-center gap-1.5 ${overdue ? 'text-danger' : 'text-muted'}`}>
                      <Icon name="calendar" className="size-3.5" />{formatDate(task.dueAt)}{overdue && <span className="sr-only"> (overdue)</span>}
                    </span>
                  ) : <span className="text-faint">—</span>}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[13px] text-faint lg:table-cell">{formatDate(task.updatedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
