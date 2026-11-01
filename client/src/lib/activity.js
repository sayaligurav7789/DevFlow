import { priorityMeta, statusMeta } from './constants.js';
import { formatDate } from './format.js';

const FIELD_NAMES = { title: 'the title', description: 'the description', dueAt: 'the due date', labels: 'the labels', assigneeId: 'the assignee', reporterId: 'the reporter' };

// Turns an activity row into the parts of a sentence: "<actor> <verb> <entity> <tail>".
// `nameOf(userId)` resolves user ids that were stored inside change details.
export function describeActivity(entry, nameOf) {
  const changes = entry.details?.changes ?? {};
  switch (entry.action) {
    case 'task.created': return { verb: 'created task', tail: '' };
    case 'task.status_changed': return { verb: 'moved', tail: `from ${statusMeta(changes.status?.from).label} to ${statusMeta(changes.status?.to).label}` };
    case 'task.priority_changed': return { verb: 'changed the priority of', tail: `from ${priorityMeta(changes.priority?.from).label} to ${priorityMeta(changes.priority?.to).label}` };
    case 'task.assigned': return { verb: 'assigned', tail: `to ${nameOf(changes.assigneeId?.to)}` };
    case 'task.unassigned':
      return entry.details?.reason === 'member_removed'
        ? { verb: 'unassigned', tail: '(member removed from the workspace)' }
        : { verb: 'unassigned', tail: `from ${nameOf(changes.assigneeId?.from)}` };
    case 'task.reassigned': return { verb: 'reassigned', tail: `from ${nameOf(changes.assigneeId?.from)} to ${nameOf(changes.assigneeId?.to)}` };
    case 'task.reporter_changed': return { verb: 'changed the reporter of', tail: `to ${nameOf(changes.reporterId?.to)}` };
    case 'task.updated': {
      if (changes.dueAt) return changes.dueAt.to ? { verb: 'set the due date of', tail: `to ${formatDate(changes.dueAt.to)}` } : { verb: 'removed the due date from', tail: '' };
      const fields = Object.keys(changes).map((f) => FIELD_NAMES[f] ?? f);
      return { verb: 'updated', tail: fields.length ? `(${fields.join(', ')})` : '' };
    }
    case 'task.deleted': return { verb: 'deleted task', tail: '' };
    case 'project.created': return { verb: 'created project', tail: '' };
    case 'project.updated': return { verb: 'updated project', tail: '' };
    case 'project.archived': return { verb: 'archived project', tail: '' };
    case 'project.restored': return { verb: 'restored project', tail: '' };
    case 'project.deleted': return { verb: 'deleted project', tail: '' };
    default: return { verb: entry.action.replaceAll('.', ' ').replaceAll('_', ' '), tail: '' };
  }
}

// Where clicking an entity should go, or null when it no longer exists.
export function activityLink(entry, workspaceId) {
  if (entry.action === 'task.deleted' || entry.action === 'project.deleted') return null;
  if (entry.entityType === 'project') return `/workspaces/${workspaceId}/projects/${entry.entityId}`;
  if (entry.entityType === 'task' && entry.projectId) return `/workspaces/${workspaceId}/projects/${entry.projectId}?task=${entry.entityId}`;
  return null;
}
