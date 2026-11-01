// Persistent notifications (PostgreSQL only; Redis is not involved, so they survive any outage).
//
// Producers (task / invitation controllers) call the insert helpers with the SAME transaction
// client that performs the change, so a notification exists if and only if the change committed.
// Every consumer query is scoped by user_id: a user can only ever read or mark their own rows.
import { pool } from '../db/pool.js';
import { buildTaskNotifications, clip, quoted } from './notificationRules.js';

export { buildTaskNotifications };

export async function insertNotifications(queryable, rows) {
  if (rows.length === 0) return 0;
  const values = [];
  const tuples = rows.map((row) => {
    const base = values.length;
    values.push(
      row.userId, row.workspaceId, row.actorId ?? null, row.type, row.entityType,
      row.entityId ?? null, row.projectId ?? null, clip(row.message),
      JSON.stringify(row.data ?? {}), row.dedupeKey ?? null,
    );
    const p = (offset) => `$${base + offset}`;
    return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}::JSONB, ${p(10)})`;
  });
  const result = await queryable.query(
    `INSERT INTO notifications
       (user_id, workspace_id, actor_id, type, entity_type, entity_id, project_id, message, data, dedupe_key)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    values,
  );
  return result.rowCount;
}

export async function notifyTaskEvent(queryable, event) {
  const inserted = await insertNotifications(queryable, buildTaskNotifications(event));

  // Queue Slack notifications in the same transaction as the task change. The
  // background worker delivers them only after the transaction has committed.
  let slackEvent = null;
  if (!event.deleted && event.after?.assigneeId && event.changes?.assigneeId
      && event.changes.assigneeId.to) {
    slackEvent = 'task_assigned';
  } else if (!event.deleted && event.changes?.status?.to === 'done') {
    slackEvent = 'task_completed';
  }
  if (slackEvent) {
    await queryable.query(
      `INSERT INTO integration_outbox (workspace_id, provider, event_type, payload)
       VALUES ($1, 'slack', $2, $3::JSONB)`,
      [event.workspaceId, slackEvent, JSON.stringify({
        projectId: event.projectId,
        taskId: event.task?.id,
        taskTitle: event.task?.title || 'Untitled task',
        actorName: event.actor?.displayName || 'A teammate',
      })],
    );
  }
  return inserted;
}

// If the invited email already belongs to an account, tell that account. The invitation token is
// deliberately never copied into the notification: it grants workspace access.
export async function notifyInvitation(client, { invitation, workspace, inviter }) {
  const invitee = await client.query('SELECT id::TEXT AS id FROM users WHERE email = $1', [invitation.email]);
  if (invitee.rowCount === 0) return 0;
  return insertNotifications(client, [{
    userId: invitee.rows[0].id,
    workspaceId: workspace.id,
    actorId: inviter.id,
    type: 'workspace.invitation',
    entityType: 'invitation',
    entityId: invitation.id,
    message: clip(`${inviter.displayName || 'Someone'} invited you to join ${quoted(workspace.name)} as ${invitation.role}`),
    data: { invitationId: invitation.id, role: invitation.role, workspaceName: workspace.name },
    dedupeKey: `invitation:${invitation.id}`,
  }]);
}

// The invitation can no longer be acted on (accepted or revoked): clear its unread badge.
export async function resolveInvitationNotifications(client, invitationId) {
  await client.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
     WHERE entity_type = 'invitation' AND entity_id = $1 AND read_at IS NULL`,
    [invitationId],
  );
}

// A user who leaves or is removed must stop receiving (and being able to read) that workspace's
// task titles, so their notifications for it are deleted along with their membership.
export async function deleteUserWorkspaceNotifications(client, workspaceId, userId) {
  await client.query(
    'DELETE FROM notifications WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
}

const NOTIFICATION_SELECT = `
  SELECT n.id::TEXT AS id, n.type, n.message,
         n.workspace_id::TEXT AS "workspaceId", w.name AS "workspaceName",
         n.project_id::TEXT AS "projectId", n.entity_type AS "entityType", n.entity_id::TEXT AS "entityId",
         n.actor_id::TEXT AS "actorId", a.display_name AS "actorName", n.data,
         (n.read_at IS NOT NULL) AS "read", n.read_at AS "readAt", n.created_at AS "createdAt"
  FROM notifications n
  JOIN workspaces w ON w.id = n.workspace_id
  LEFT JOIN users a ON a.id = n.actor_id`;

export async function countUnread(userId, { workspaceId } = {}) {
  const values = [userId];
  let scope = '';
  if (workspaceId) {
    values.push(workspaceId);
    scope = ' AND workspace_id = $2';
  }
  const result = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count FROM notifications
     WHERE user_id = $1 AND read_at IS NULL${scope}`,
    values,
  );
  return result.rows[0].count;
}

export async function listNotifications(userId, { unreadOnly = false, workspaceId, limit, offset }) {
  const filters = ['n.user_id = $1'];
  const values = [userId];
  if (workspaceId) {
    values.push(workspaceId);
    filters.push(`n.workspace_id = $${values.length}`);
  }
  if (unreadOnly) filters.push('n.read_at IS NULL');
  const where = filters.join(' AND ');

  const count = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM notifications n WHERE ${where}`, values);
  const rows = await pool.query(
    `${NOTIFICATION_SELECT}
     WHERE ${where}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  return { notifications: rows.rows, total: count.rows[0].total };
}

export async function getNotification(userId, notificationId) {
  const result = await pool.query(
    `${NOTIFICATION_SELECT} WHERE n.id = $1 AND n.user_id = $2`,
    [notificationId, userId],
  );
  return result.rows[0] ?? null;
}

// Idempotent. Returns null when the notification does not exist OR belongs to someone else, which
// the caller reports as 404 so ids of other users' notifications cannot be probed.
export async function markNotificationRead(userId, notificationId) {
  const updated = await pool.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [notificationId, userId],
  );
  if (updated.rowCount === 0) return null;
  return getNotification(userId, notificationId);
}

export async function markAllNotificationsRead(userId, { workspaceId } = {}) {
  const values = [userId];
  let scope = '';
  if (workspaceId) {
    values.push(workspaceId);
    scope = ' AND workspace_id = $2';
  }
  const result = await pool.query(
    `UPDATE notifications SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL${scope}`,
    values,
  );
  return result.rowCount;
}
