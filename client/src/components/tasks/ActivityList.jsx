import { useEffect, useState } from 'react';
import { taskApi } from '../../lib/endpoints.js';
import { priorityMeta, statusMeta } from '../../lib/constants.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { Avatar, Button, Notice, Spinner } from '../ui/index.js';

const FIELD_NAMES = { title: 'the title', description: 'the description', dueAt: 'the due date', labels: 'the labels', assigneeId: 'the assignee', reporterId: 'the reporter' };

function describe(entry, nameOf) {
  const changes = entry.details?.changes ?? {};
  const fields = Object.keys(changes);
  switch (entry.action) {
    case 'task.created': return 'created this task';
    case 'task.status_changed': return `changed status from ${statusMeta(changes.status?.from).label} to ${statusMeta(changes.status?.to).label}`;
    case 'task.priority_changed': return `changed priority from ${priorityMeta(changes.priority?.from).label} to ${priorityMeta(changes.priority?.to).label}`;
    case 'task.assigned': return `assigned this to ${nameOf(changes.assigneeId?.to)}`;
    case 'task.unassigned': return `unassigned ${nameOf(changes.assigneeId?.from)}`;
    case 'task.reassigned': return `reassigned from ${nameOf(changes.assigneeId?.from)} to ${nameOf(changes.assigneeId?.to)}`;
    case 'task.reporter_changed': return `changed the reporter to ${nameOf(changes.reporterId?.to)}`;
    case 'task.updated': {
      if (changes.dueAt) return changes.dueAt.to ? `set the due date to ${formatDate(changes.dueAt.to)}` : 'removed the due date';
      return `updated ${fields.map((f) => FIELD_NAMES[f] ?? f).join(', ') || 'this task'}`;
    }
    case 'task.deleted': return 'deleted this task';
    default: return entry.action.replace('task.', '').replaceAll('_', ' ');
  }
}

// Paginated activity history straight from GET /projects/:id/tasks/:id/activity.
export function ActivityList({ projectId, taskId, members, refreshKey }) {
  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const nameOf = (id) => members.find((m) => m.id === String(id))?.displayName ?? 'a former member';

  async function load(page) {
    setLoading(true);
    setError(null);
    try {
      const data = await taskApi.activity(projectId, taskId, { page, limit: 10 });
      setEntries((current) => (page === 1 ? data.activity : [...current, ...data.activity]));
      setPagination(data.pagination);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(1); }, [projectId, taskId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-labelledby="activity-heading">
      <h3 id="activity-heading" className="mb-3 text-[12.5px] font-semibold text-fg">Activity</h3>
      {error && <Notice tone="error" className="mb-3">{error.message}</Notice>}
      <ol className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-2.5">
            <Avatar name={entry.actorName ?? '?'} id={entry.actorId} size="xs" className="mt-0.5" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-5 text-muted">
              <span className="font-medium text-fg">{entry.actorName ?? 'A former member'}</span>{' '}
              {describe(entry, nameOf)}
              <time dateTime={entry.createdAt} className="ml-1.5 text-faint" title={formatDateTime(entry.createdAt)}>· {formatDateTime(entry.createdAt)}</time>
            </p>
          </li>
        ))}
      </ol>
      {loading && <div role="status" className="flex items-center gap-2 py-2 text-[12.5px] text-muted"><Spinner className="size-3.5" />Loading activity…</div>}
      {!loading && pagination && pagination.page < pagination.totalPages && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => load(pagination.page + 1)}>Show older activity</Button>
      )}
    </section>
  );
}
