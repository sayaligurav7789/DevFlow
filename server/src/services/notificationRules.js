// Pure notification rules: who is told what about a task event. No database and no I/O, so the
// rules are unit-tested directly (test/notification-rules.test.js).
export const MESSAGE_LIMIT = 500;
const IMPORTANT_TASK_FIELDS = ['status', 'priority', 'dueAt'];

export const clip = (text) => (text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text);
export const quoted = (title) => `"${title}"`;

function describeValue(field, value) {
  if (value === null || value === undefined) return 'none';
  if (field === 'dueAt') return String(value).slice(0, 10);
  return String(value).replace('_', ' ');
}

const FIELD_LABELS = { status: 'status', priority: 'priority', dueAt: 'due date' };

function unique(ids) {
  return [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))];
}

// Pure: decides who is told what about a task event. No I/O, so the rules are unit-tested directly.
//   actor    { id, displayName }          the user who made the change (never notified about it)
//   task     { id, title }
//   after    { assigneeId, reporterId }   state after the change
//   changes  { field: { from, to } }      only fields that actually changed (same shape as activity)
//   deleted  true when the task was removed
export function buildTaskNotifications({
  actor, workspaceId, projectId, task, after, changes = {}, deleted = false,
}) {
  const actorId = String(actor.id);
  const name = actor.displayName || 'Someone';
  const rows = [];
  const told = new Set();

  const make = (userId, type, message, data = {}) => ({
    userId: String(userId),
    workspaceId: String(workspaceId),
    actorId,
    type,
    entityType: 'task',
    entityId: String(task.id),
    projectId: String(projectId),
    message: clip(message),
    data: { taskId: String(task.id), projectId: String(projectId), title: task.title, ...data },
  });

  if (deleted) {
    for (const userId of unique([after.assigneeId, after.reporterId])) {
      if (userId !== actorId) rows.push(make(userId, 'task.deleted', `${name} deleted ${quoted(task.title)}`));
    }
    return rows;
  }

  if (changes.assigneeId) {
    const from = changes.assigneeId.from === null ? null : String(changes.assigneeId.from);
    const to = changes.assigneeId.to === null ? null : String(changes.assigneeId.to);
    if (to !== null && to !== actorId) {
      const message = from === null
        ? `${name} assigned you ${quoted(task.title)}`
        : `${name} reassigned ${quoted(task.title)} to you`;
      rows.push(make(to, 'task.assigned', message, { previousAssigneeId: from }));
      told.add(to);
    }
    if (from !== null && from !== actorId && from !== to) {
      const message = to === null
        ? `${name} unassigned you from ${quoted(task.title)}`
        : `${quoted(task.title)} was reassigned from you by ${name}`;
      rows.push(make(from, 'task.reassigned', message, { newAssigneeId: to }));
      told.add(from);
    }
  }

  const important = IMPORTANT_TASK_FIELDS.filter((field) => changes[field]);
  if (important.length > 0) {
    const summary = important
      .map((field) => `${FIELD_LABELS[field]} ${describeValue(field, changes[field].from)} → ${describeValue(field, changes[field].to)}`)
      .join(', ');
    const data = { changes: Object.fromEntries(important.map((field) => [field, changes[field]])) };
    for (const userId of unique([after.assigneeId, after.reporterId])) {
      if (userId === actorId || told.has(userId)) continue;
      rows.push(make(userId, 'task.updated', `${name} updated ${quoted(task.title)}: ${summary}`, data));
    }
  }
  return rows;
}
