import { Link } from 'react-router-dom';
import { activityLink, describeActivity } from '../lib/activity.js';
import { formatDateTime, timeAgo } from '../lib/format.js';
import { Avatar } from './ui/index.js';

// One row per event: who did what, to which task or project, and when.
export function ActivityFeed({ entries, workspaceId, nameOf = () => 'a teammate', showProject = true }) {
  return (
    <ol className="divide-y divide-line">
      {entries.map((entry) => {
        const { verb, tail } = describeActivity(entry, nameOf);
        const href = activityLink(entry, workspaceId);
        const fallback = entry.entityType === 'project' ? 'a project' : entry.entityType === 'task' ? 'a task' : '';
        const name = entry.entityName || fallback;
        return (
          <li key={entry.id} className="flex gap-3 px-4 py-3">
            <Avatar name={entry.actorName ?? '?'} id={entry.actorId} size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-5 text-muted">
                <span className="font-medium text-fg">{entry.actorName ?? 'A former member'}</span>{' '}
                {verb}{' '}
                {name && (href
                  ? <Link to={href} className="font-medium text-fg hover:underline">{name}</Link>
                  : <span className="font-medium text-fg">{name}</span>)}
                {tail && <> {tail}</>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
                {showProject && entry.entityType === 'task' && entry.projectName && <span className="truncate">in {entry.projectName}</span>}
                <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>{timeAgo(entry.createdAt)}</time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
