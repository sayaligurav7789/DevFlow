import { OPEN_STATUSES, PRIORITIES, STATUSES } from '../../lib/constants.js';
import { Button, FilterSelect, SearchInput } from '../ui/index.js';

export const TASK_SORT_OPTIONS = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'createdAt:desc', label: 'Newest' },
  { value: 'createdAt:asc', label: 'Oldest' },
  { value: 'dueAt:asc', label: 'Due soonest' },
  { value: 'priority:desc', label: 'Priority (high → low)' },
  { value: 'status:asc', label: 'Status' },
  { value: 'title:asc', label: 'Title (A → Z)' },
];

// status: 'all' | 'open' | <status>. 'open' means every status except done.
export function statusParam(value) {
  if (value === 'open') return OPEN_STATUSES;
  if (!value || value === 'all') return undefined;
  return value;
}

export function TaskFilterBar({ values, set, activeFilterCount, onClear, members, currentUserId, assigneeMode = 'all', projects }) {
  const sort = `${values.sortBy}:${values.sortOrder}`;
  return (
    <div role="search" aria-label="Filter tasks" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
      <SearchInput value={values.q} onChange={(q) => set({ q })} placeholder="Search tasks" label="Search tasks" className="w-full sm:w-56" />
      <FilterSelect label="Filter by status" value={values.status} onChange={(v) => set({ status: v })}>
        <option value="all">All statuses</option>
        <option value="open">Open (not done)</option>
        {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </FilterSelect>
      <FilterSelect label="Filter by priority" value={values.priority} onChange={(v) => set({ priority: v })}>
        <option value="">All priorities</option>
        {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </FilterSelect>
      {assigneeMode === 'all' && (
        <FilterSelect label="Filter by assignee" value={values.assigneeId} onChange={(v) => set({ assigneeId: v })}>
          <option value="">Anyone</option>
          <option value={currentUserId}>Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {members.filter((m) => m.id !== currentUserId).map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
        </FilterSelect>
      )}
      {projects && (
        <FilterSelect label="Filter by project" value={values.projectId} onChange={(v) => set({ projectId: v })}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}
        </FilterSelect>
      )}
      <FilterSelect label="Sort tasks" value={sort} onChange={(v) => { const [sortBy, sortOrder] = v.split(':'); set({ sortBy, sortOrder }); }} className="sm:ml-auto">
        {TASK_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </FilterSelect>
      {activeFilterCount > 0 && (
        <Button size="sm" variant="ghost" onClick={onClear}>Clear filters</Button>
      )}
    </div>
  );
}
