import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { taskApi } from '../../lib/endpoints.js';
import { PRIORITIES, STATUSES, statusMeta, priorityMeta } from '../../lib/constants.js';
import { formatDate } from '../../lib/format.js';
import { Button, Card, ErrorState, FilterSelect, Notice, SearchInput, Skeleton } from '../../components/ui/index.js';

const DAY = 86_400_000;
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null;
const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const monthStart = (date) => new Date(date.getFullYear(), date.getMonth(), 1, 12);
const monthLabel = (date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const shortDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const taskTone = (task) => task.status === 'done' ? 'border-success/30 bg-success/10 text-success' : task.priority === 'urgent' ? 'border-danger/30 bg-danger/10 text-danger' : task.priority === 'high' ? 'border-warning/30 bg-warning/10 text-warning' : 'border-line bg-panel text-fg';

function useProjectTasks(projectId, refreshKey, filters) {
  const [state, setState] = useState({ tasks: [], loading: true, error: null });
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const first = await taskApi.list(projectId, { ...filters, sortBy: 'dueAt', sortOrder: 'asc', page: 1, limit: 100 }, { signal: controller.signal });
        let all = first.tasks ?? [];
        const pages = Math.min(first.pagination?.totalPages ?? 1, 100);
        for (let page = 2; page <= pages; page += 1) {
          const next = await taskApi.list(projectId, { ...filters, sortBy: 'dueAt', sortOrder: 'asc', page, limit: 100 }, { signal: controller.signal });
          all = all.concat(next.tasks ?? []);
        }
        if (active) setState({ tasks: all, loading: false, error: null });
      } catch (error) {
        if (active && error.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error }));
      }
    }
    load();
    return () => { active = false; controller.abort(); };
  }, [projectId, refreshKey, filterKey]);
  return state;
}

function TaskPill({ task, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(task)} className={`block w-full truncate rounded-md border px-2 py-1 text-left text-[11px] font-medium transition-colors hover:border-accent hover:bg-hover ${taskTone(task)}`} title={`${task.title} · ${statusMeta(task.status).label} · ${priorityMeta(task.priority).label}`}>
      <span className="mr-1 opacity-70">{task.status === 'done' ? '✓' : '•'}</span>{task.title}
    </button>
  );
}

function Calendar({ tasks, date, setDate, onOpen }) {
  const first = monthStart(date);
  const offset = first.getDay();
  const gridStart = addDays(first, -offset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const grouped = useMemo(() => {
    const map = new Map();
    for (const task of tasks) {
      if (!task.dueAt) continue;
      const key = String(task.dueAt).slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [tasks]);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div><h2 className="text-sm font-semibold text-fg">{monthLabel(date)}</h2><p className="text-xs text-muted">Tasks are placed on their due dates</p></div>
        <div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setDate(new Date())}>Today</Button><Button size="sm" variant="secondary" icon="chevronLeft" aria-label="Previous month" onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() - 1, 1, 12))} /><Button size="sm" variant="secondary" icon="chevronRight" aria-label="Next month" onClick={() => setDate(new Date(date.getFullYear(), date.getMonth() + 1, 1, 12))} /></div>
      </div>
      <div className="grid grid-cols-7 border-b border-line bg-sidebar">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="px-2 py-2 text-center text-[11px] font-semibold text-muted">{day}</div>)}</div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = keyOf(day); const entries = grouped.get(key) ?? []; const inMonth = day.getMonth() === date.getMonth(); const today = key === keyOf(new Date());
          return <div key={key} className={`min-h-28 border-b border-r border-line p-1.5 ${inMonth ? 'bg-panel' : 'bg-sidebar/50'}`}>
            <div className={`mb-1 flex size-6 items-center justify-center rounded-full text-[11px] ${today ? 'bg-accent font-semibold text-accent-fg' : inMonth ? 'text-fg' : 'text-faint'}`}>{day.getDate()}</div>
            <div className="space-y-1">{entries.slice(0, 3).map((task) => <TaskPill key={task.id} task={task} onOpen={onOpen} />)}{entries.length > 3 && <p className="px-1 text-[10px] text-muted">+{entries.length - 3} more</p>}</div>
          </div>;
        })}
      </div>
      <div className="flex flex-wrap gap-3 px-4 py-3 text-[11px] text-muted"><span>● Done</span><span className="text-danger">● Urgent</span><span className="text-warning">● High priority</span><span>Tasks without due dates are not shown.</span></div>
    </Card>
  );
}

function Timeline({ tasks, date, setDate, onOpen }) {
  const start = addDays(date, -7);
  const days = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const visible = tasks.filter((task) => task.dueAt).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const startMs = start.getTime();
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3"><div><h2 className="text-sm font-semibold text-fg">Project timeline</h2><p className="text-xs text-muted">Created date → due date · 5-week window</p></div><div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setDate(new Date())}>Today</Button><Button size="sm" variant="secondary" icon="chevronLeft" aria-label="Previous timeline" onClick={() => setDate(addDays(date, -28))} /><Button size="sm" variant="secondary" icon="chevronRight" aria-label="Next timeline" onClick={() => setDate(addDays(date, 28))} /></div></div>
      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[minmax(210px,260px)_1fr] border-b border-line bg-sidebar"><div className="px-4 py-2 text-xs font-semibold text-muted">Task</div><div className="grid grid-cols-[repeat(35,minmax(0,1fr))]">{days.map((day) => <div key={keyOf(day)} className={`border-l border-line px-0.5 py-2 text-center text-[10px] ${day.getDay() === 0 ? 'font-semibold text-fg' : 'text-muted'}`}>{day.getDate()}</div>)}</div></div>
          {visible.length === 0 ? <p className="p-8 text-center text-sm text-muted">No tasks with due dates in this project yet.</p> : visible.map((task) => {
            const due = parseDay(task.dueAt); const created = parseDay(task.createdAt) ?? due; const left = Math.max(0, Math.floor((created.getTime() - startMs) / DAY)); const right = Math.min(34, Math.floor((due.getTime() - startMs) / DAY)); const width = Math.max(1, right - left + 1); const visibleBar = right >= 0 && left <= 34;
            return <div key={task.id} className="grid min-h-12 grid-cols-[minmax(210px,260px)_1fr] border-b border-line last:border-0"><div className="flex min-w-0 items-center px-4"><button type="button" onClick={() => onOpen(task)} className="truncate text-left text-xs font-medium text-fg hover:text-accent hover:underline">{task.title}</button></div><div className="relative grid grid-cols-[repeat(35,minmax(0,1fr))] items-center">{days.map((day) => <div key={keyOf(day)} className="h-full border-l border-line" />)}{visibleBar && <button type="button" onClick={() => onOpen(task)} title={`${task.title}: created ${formatDate(task.createdAt)}, due ${formatDate(task.dueAt)}`} className={`absolute top-1/2 h-6 -translate-y-1/2 truncate rounded px-2 text-left text-[10px] font-semibold ${task.status === 'done' ? 'bg-success/20 text-success' : task.priority === 'urgent' ? 'bg-danger/15 text-danger' : task.priority === 'high' ? 'bg-warning/20 text-warning' : 'bg-accent/15 text-accent'}`} style={{ left: `${(left / 35) * 100}%`, width: `${(width / 35) * 100}%` }}>{task.status === 'done' ? '✓ ' : ''}{width > 2 ? task.title : ''}</button>}</div></div>;
          })}
        </div>
      </div>
      <div className="border-t border-line px-4 py-3 text-[11px] text-muted">Timeline start is based on task creation date because this project currently stores due dates, not a separate planned start date.</div>
    </Card>
  );
}

export function ProjectScheduleView({ mode }) {
  const { project, members, openTask, refreshKey, user } = useOutletContext();
  const [date, setDate] = useState(new Date());
  const [q, setQ] = useState(''); const [priority, setPriority] = useState(''); const [assigneeId, setAssigneeId] = useState(''); const [status, setStatus] = useState('');
  const filters = { q: q || undefined, priority: priority || undefined, assigneeId: assigneeId || undefined, status: status || undefined };
  const result = useProjectTasks(project.id, refreshKey, filters);
  const dueTasks = result.tasks.filter((task) => task.dueAt);
  return <>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <SearchInput value={q} onChange={setQ} placeholder="Search tasks" label="Search tasks" className="w-full sm:w-56" />
      <FilterSelect label="Filter by status" value={status} onChange={setStatus}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</FilterSelect>
      <FilterSelect label="Filter by priority" value={priority} onChange={setPriority}><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</FilterSelect>
      <FilterSelect label="Filter by assignee" value={assigneeId} onChange={setAssigneeId}><option value="">Anyone</option><option value={user.id}>Assigned to me</option><option value="unassigned">Unassigned</option>{members.filter((m) => m.id !== user.id).map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</FilterSelect>
      {(q || priority || assigneeId || status) && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setPriority(''); setAssigneeId(''); setStatus(''); }}>Clear filters</Button>}
      <span className="ml-auto text-xs text-muted">{dueTasks.length} scheduled task{dueTasks.length === 1 ? '' : 's'}</span>
    </div>
    {project.archived && <Notice tone="warning" className="mb-4">This project is archived and its tasks are read-only.</Notice>}
    {result.loading && !result.tasks.length ? <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>
      : result.error ? <ErrorState error={result.error} title="Couldn’t load scheduled tasks" onRetry={() => setDate(new Date(date))} />
      : mode === 'calendar' ? <Calendar tasks={result.tasks} date={date} setDate={setDate} onOpen={openTask} /> : <Timeline tasks={result.tasks} date={date} setDate={setDate} onOpen={openTask} />}
  </>;
}
