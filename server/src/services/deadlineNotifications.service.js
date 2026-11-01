// Deadline notifications: "due soon" and "overdue" for the assignee of an open task.
//
// This is a single set-based INSERT ... SELECT per kind, made idempotent by the unique
// (user_id, dedupe_key) index. That is why no job queue (BullMQ) is needed: the work is one cheap
// SQL statement, it is safe to run on every backend instance at once (duplicates are discarded by
// PostgreSQL), and a missed run is simply caught by the next one. The dedupe key contains the due
// timestamp, so changing a task's due date legitimately produces a fresh notification.
//
// "Today" is the start of the current UTC day, identical to the dashboard's definition, so a task
// the dashboard counts as overdue is exactly a task this sweep reports as overdue.
import { pool } from '../db/pool.js';
import { config } from '../config/env.js';

const TODAY_SQL = `(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

// Tasks that went overdue longer ago than this are not announced. Without a cap, the first sweep
// after deployment would flood every assignee with notifications about long-abandoned tasks.
export const OVERDUE_LOOKBACK_DAYS = 7;

const COMMON_FILTER = `
  p.archived_at IS NULL
  AND t.status <> 'done'
  AND t.assignee_id IS NOT NULL
  AND t.due_at IS NOT NULL`;

const COMMON_JOINS = `
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = t.assignee_id`;

export async function generateDeadlineNotifications(
  queryable = pool,
  { dueSoonWindowHours = config.notifications.dueSoonWindowHours } = {},
) {
  const dueSoon = await queryable.query(
    `INSERT INTO notifications
       (user_id, workspace_id, type, entity_type, entity_id, project_id, message, data, dedupe_key)
     SELECT t.assignee_id, p.workspace_id, 'deadline.due_soon', 'task', t.id, p.id,
            left(format('"%s" is due %s', t.title, to_char(t.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')), 500),
            jsonb_build_object('taskId', t.id::TEXT, 'projectId', p.id::TEXT, 'title', t.title, 'dueAt', t.due_at),
            'deadline:due_soon:' || t.id::TEXT || ':' || (EXTRACT(EPOCH FROM t.due_at))::BIGINT::TEXT
     ${COMMON_JOINS}
     WHERE ${COMMON_FILTER}
       AND t.due_at >= ${TODAY_SQL}
       AND t.due_at < now() + make_interval(hours => $1)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [dueSoonWindowHours],
  );

  const overdue = await queryable.query(
    `INSERT INTO notifications
       (user_id, workspace_id, type, entity_type, entity_id, project_id, message, data, dedupe_key)
     SELECT t.assignee_id, p.workspace_id, 'deadline.overdue', 'task', t.id, p.id,
            left(format('"%s" is overdue (was due %s)', t.title, to_char(t.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')), 500),
            jsonb_build_object('taskId', t.id::TEXT, 'projectId', p.id::TEXT, 'title', t.title, 'dueAt', t.due_at),
            'deadline:overdue:' || t.id::TEXT || ':' || (EXTRACT(EPOCH FROM t.due_at))::BIGINT::TEXT
     ${COMMON_JOINS}
     WHERE ${COMMON_FILTER}
       AND t.due_at < ${TODAY_SQL}
       AND t.due_at >= ${TODAY_SQL} - make_interval(days => $1)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [OVERDUE_LOOKBACK_DAYS],
  );

  return { dueSoon: dueSoon.rowCount, overdue: overdue.rowCount };
}
