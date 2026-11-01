import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';
import { isValidBigintId, withTransaction } from '../services/workspaceAccess.service.js';
import { invalidateWorkspaceDashboard } from '../services/cache.service.js';
import { notifyTaskEvent } from '../services/notifications.service.js';
import { allowlistedValue } from '../utils/allowlist.js';

const STATUSES = new Set(['backlog', 'todo', 'in_progress', 'in_review', 'done']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const TASK_SORTS = Object.freeze({
  title: 't.title',
  status: `CASE t.status
    WHEN 'backlog' THEN 0 WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2
    WHEN 'in_review' THEN 3 WHEN 'done' THEN 4 END`,
  priority: `CASE t.priority
    WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'urgent' THEN 3 END`,
  dueAt: 't.due_at',
  position: 't.position',
  createdAt: 't.created_at',
  updatedAt: 't.updated_at',
});
const TASK_QUERY_KEYS = new Set([
  'q', 'status', 'priority', 'assigneeId', 'reporterId', 'label',
  'dueBefore', 'dueAfter', 'sortBy', 'sortOrder', 'page', 'limit',
]);
const TASK_BODY_KEYS = new Set([
  'title', 'description', 'status', 'priority', 'assigneeId', 'reporterId', 'dueAt', 'labels',
]);
const TASK_COLUMNS = Object.freeze({
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee_id',
  reporterId: 'reporter_id',
  dueAt: 'due_at',
  labels: 'labels',
});

function objectBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw httpError(400, `Unknown ${label} field: ${unknown}`);
}

function validPageValue(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function parsePagination(query) {
  const page = validPageValue(query.page, 1, 1_000_000);
  const limit = validPageValue(query.limit, 20, 100);
  if (page === null) throw httpError(400, 'page must be a positive integer');
  if (limit === null) throw httpError(400, 'limit must be an integer between 1 and 100');
  return { page, limit, offset: (page - 1) * limit };
}

function normalizeTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length > 0 && title.length <= 200 ? title : null;
}

function normalizeDescription(value) {
  if (typeof value !== 'string') return null;
  const description = value.trim();
  return description.length <= 10_000 ? description : null;
}

function normalizeLabels(value) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const labels = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const label = item.trim();
    if (label.length < 1 || label.length > 40) return null;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

function normalizeDueAt(value) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!dateOnly && !dateTime) return undefined;
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  if (dateOnly && parsed.toISOString().slice(0, 10) !== value) return undefined;
  return parsed.toISOString();
}

function normalizeId(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!isValidBigintId(value)) throw httpError(400, `${field} must be a valid user id${nullable ? ' or null' : ''}`);
  return value;
}

function parseEnum(value, values, field) {
  if (typeof value !== 'string' || !values.has(value)) {
    throw httpError(400, `${field} is invalid`);
  }
  return value;
}

function parseDateFilter(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpError(400, `${field} must be a date in YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw httpError(400, `${field} must be a valid date`);
  }
  return value;
}

async function projectAccess(queryable, projectId, userId, { lock = false } = {}) {
  const result = await queryable.query(
    `SELECT p.id::TEXT AS id, p.workspace_id::TEXT AS "workspaceId",
            p.archived_at AS "archivedAt", wm.role
     FROM projects p
     JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
     WHERE p.id = $1 AND wm.user_id = $2
     ${lock ? 'FOR UPDATE OF p, wm' : ''}`,
    [projectId, userId],
  );
  if (result.rowCount === 0) throw httpError(404, 'Project not found');
  return result.rows[0];
}

async function ensureWorkspaceMember(client, workspaceId, userId, field) {
  if (userId === undefined || userId === null) return;
  const result = await client.query(
    'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR KEY SHARE',
    [workspaceId, userId],
  );
  if (result.rowCount === 0) throw httpError(400, `${field} must be a member of this workspace`);
}

const TASK_COLUMNS_SQL = `t.id::TEXT AS id, t.project_id::TEXT AS "projectId",
                                p.workspace_id::TEXT AS "workspaceId",
                                p.name AS "projectName", p.slug AS "projectSlug",
                                (p.archived_at IS NOT NULL) AS "projectArchived",
                                t.title, t.description, t.status, t.priority,
                                t.assignee_id::TEXT AS "assigneeId", assignee.display_name AS "assigneeName",
                                t.reporter_id::TEXT AS "reporterId", reporter.display_name AS "reporterName",
                                t.created_by::TEXT AS "createdById",
                                t.due_at AS "dueAt", t.labels,
                                t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;
const TASK_JOINS_SQL = `JOIN projects p ON p.id = t.project_id
                         LEFT JOIN users assignee ON assignee.id = t.assignee_id
                         LEFT JOIN users reporter ON reporter.id = t.reporter_id`;
const TASK_ROW_SELECT = `SELECT ${TASK_COLUMNS_SQL}
                         FROM tasks t
                         ${TASK_JOINS_SQL}`;

async function readTask(queryable, projectId, taskId) {
  const result = await queryable.query(
    `${TASK_ROW_SELECT} WHERE t.project_id = $1 AND t.id = $2`,
    [projectId, taskId],
  );
  if (result.rowCount === 0) throw httpError(404, 'Task not found');
  return result.rows[0];
}

// `project` is the row returned by projectAccess (id + workspaceId); recording the project
// keeps task history queryable per project even after the task row is deleted.
async function insertTaskActivity(client, project, actorId, action, taskId, details = {}) {
  await client.query(
    `INSERT INTO activity_logs (workspace_id, actor_id, action, entity_type, entity_id, project_id, details)
     VALUES ($1, $2, $3, 'task', $4, $5, $6::JSONB)`,
    [project.workspaceId, actorId, action, taskId, project.id, JSON.stringify(details)],
  );
}

function queryEnumList(value, values, field) {
  if (typeof value !== 'string' || value.length > 200) throw httpError(400, `${field} is invalid`);
  const items = [...new Set(value.split(','))];
  if (items.some((item) => !values.has(item))) throw httpError(400, `${field} contains an invalid value`);
  return items;
}

// Shared by the project-scoped and workspace-scoped task lists. Every dynamic
// value is a bound parameter; sort columns come from the TASK_SORTS allowlist.
function parseTaskListQuery(query, scope, { allowProjectFilter = false } = {}) {
  const { page, limit, offset } = parsePagination(query);
  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'desc';
  const sortColumn = allowlistedValue(TASK_SORTS, sortBy);
  if (!sortColumn) throw httpError(400, 'sortBy must be title, status, priority, dueAt, position, createdAt, or updatedAt');
  if (!['asc', 'desc'].includes(sortOrder)) throw httpError(400, 'sortOrder must be asc or desc');

  const filters = [scope.clause];
  const values = [scope.value];
  const add = (value, clause) => {
    values.push(value);
    filters.push(clause.replaceAll('?', `$${values.length}`));
  };
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.trim().length > 150) throw httpError(400, 'q must be at most 150 characters');
    add(`%${query.q.trim()}%`, '(t.title ILIKE ? OR t.description ILIKE ?)');
  }
  if (query.status !== undefined) add(queryEnumList(query.status, STATUSES, 'status'), 't.status = ANY(?::TEXT[])');
  if (query.priority !== undefined) add(queryEnumList(query.priority, PRIORITIES, 'priority'), 't.priority = ANY(?::TEXT[])');
  if (query.assigneeId !== undefined) {
    if (query.assigneeId === 'unassigned') {
      filters.push('t.assignee_id IS NULL');
    } else {
      if (!isValidBigintId(query.assigneeId)) throw httpError(400, 'assigneeId must be a valid user id or unassigned');
      add(query.assigneeId, 't.assignee_id = ?');
    }
  }
  if (query.reporterId !== undefined) {
    if (!isValidBigintId(query.reporterId)) throw httpError(400, 'reporterId must be a valid user id');
    add(query.reporterId, 't.reporter_id = ?');
  }
  if (allowProjectFilter && query.projectId !== undefined) {
    if (!isValidBigintId(query.projectId)) throw httpError(400, 'projectId must be a valid project id');
    add(query.projectId, 't.project_id = ?');
  }
  if (query.label !== undefined) {
    if (typeof query.label !== 'string' || query.label.trim().length < 1 || query.label.trim().length > 40) {
      throw httpError(400, 'label must be between 1 and 40 characters');
    }
    add(query.label.trim(), '? = ANY(t.labels)');
  }
  if (query.dueAfter !== undefined) add(parseDateFilter(query.dueAfter, 'dueAfter'), 't.due_at >= ?::DATE');
  if (query.dueBefore !== undefined) {
    add(parseDateFilter(query.dueBefore, 'dueBefore'), `t.due_at < (?::DATE + INTERVAL '1 day')`);
  }
  return { where: filters.join(' AND '), values, sortBy, sortOrder, sortColumn, page, limit, offset };
}

async function sendTaskList(res, parsed) {
  const { where, values, sortBy, sortOrder, sortColumn, page, limit, offset } = parsed;
  const count = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE ${where}`,
    values,
  );
  const rows = await pool.query(
    `${TASK_ROW_SELECT}
     WHERE ${where}
     ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}${sortBy === 'dueAt' ? ' NULLS LAST' : ''}, t.id ASC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  const total = count.rows[0].total;
  return res.json({
    tasks: rows.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function listTasks(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    assertKnownKeys(req.query, TASK_QUERY_KEYS, 'query');
    await projectAccess(pool, req.params.projectId, req.user.id);
    const parsed = parseTaskListQuery(req.query, { clause: 't.project_id = $1', value: req.params.projectId });
    return await sendTaskList(res, parsed);
  } catch (error) {
    return next(error);
  }
}

// GET /api/workspaces/:workspaceId/tasks - tasks across every project in a
// workspace the caller belongs to (membership is enforced by the router's
// requireWorkspaceAccess middleware). Adds an optional projectId filter.
export async function listWorkspaceTasks(req, res, next) {
  try {
    assertKnownKeys(req.query, new Set([...TASK_QUERY_KEYS, 'projectId']), 'query');
    const parsed = parseTaskListQuery(
      req.query,
      { clause: 'p.workspace_id = $1', value: req.workspace.id },
      { allowProjectFilter: true },
    );
    return await sendTaskList(res, parsed);
  } catch (error) {
    return next(error);
  }
}

export async function createTask(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    const body = objectBody(req.body);
    if (!body) throw httpError(400, 'Request body must be an object');
    assertKnownKeys(body, TASK_BODY_KEYS, 'task');
    const title = normalizeTitle(body.title);
    const description = body.description === undefined ? '' : normalizeDescription(body.description);
    const status = body.status === undefined ? 'todo' : parseEnum(body.status, STATUSES, 'status');
    const priority = body.priority === undefined ? 'medium' : parseEnum(body.priority, PRIORITIES, 'priority');
    const assigneeId = body.assigneeId === undefined ? null : normalizeId(body.assigneeId, 'assigneeId', { nullable: true });
    const reporterId = body.reporterId === undefined ? String(req.user.id) : normalizeId(body.reporterId, 'reporterId');
    const dueAt = body.dueAt === undefined ? null : normalizeDueAt(body.dueAt);
    const labels = body.labels === undefined ? [] : normalizeLabels(body.labels);
    if (!title) throw httpError(400, 'Title must be between 1 and 200 characters');
    if (description === null) throw httpError(400, 'Description must be at most 10000 characters');
    if (dueAt === undefined) throw httpError(400, 'dueAt must be null, a YYYY-MM-DD date, or an ISO date-time');
    if (labels === null) throw httpError(400, 'labels must contain at most 20 non-empty strings of at most 40 characters');

    const task = await withTransaction(async (client) => {
      const project = await projectAccess(client, req.params.projectId, req.user.id, { lock: true });
      if (project.archivedAt) throw httpError(409, 'Tasks cannot be created in an archived project');
      if (body.reporterId !== undefined && !['owner', 'admin'].includes(project.role)) {
        throw httpError(403, 'Only workspace owners and admins can set another reporter');
      }
      await ensureWorkspaceMember(client, project.workspaceId, assigneeId, 'assigneeId');
      await ensureWorkspaceMember(client, project.workspaceId, reporterId, 'reporterId');
      const inserted = await client.query(
        `INSERT INTO tasks
           (project_id, title, description, status, priority, assignee_id, reporter_id, created_by, due_at, labels, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 COALESCE((SELECT MAX(position) FROM tasks WHERE project_id = $1 AND status = $4), 0) + 1024)
         RETURNING id::TEXT AS id`,
        [
          req.params.projectId, title, description, status, priority,
          assigneeId, reporterId, req.user.id, dueAt, labels,
        ],
      );
      const id = inserted.rows[0].id;
      await insertTaskActivity(client, project, req.user.id, 'task.created', id, {
        title, status, priority, assigneeId, reporterId,
      });
      if (assigneeId) {
        await notifyTaskEvent(client, {
          actor: req.user,
          workspaceId: project.workspaceId,
          projectId: project.id,
          task: { id, title },
          after: { assigneeId, reporterId },
          changes: { assigneeId: { from: null, to: assigneeId } },
        });
      }
      return readTask(client, req.params.projectId, id);
    });
    await invalidateWorkspaceDashboard(task.workspaceId);
    return res.status(201).json({ task });
  } catch (error) {
    return next(error);
  }
}

export async function getTask(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  if (!isValidBigintId(req.params.taskId)) return next(httpError(404, 'Task not found'));
  try {
    await projectAccess(pool, req.params.projectId, req.user.id);
    return res.json({ task: await readTask(pool, req.params.projectId, req.params.taskId) });
  } catch (error) {
    return next(error);
  }
}

function comparableTaskValue(field, value) {
  if (field === 'dueAt') {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : value;
  }
  if (field === 'assigneeId' || field === 'reporterId') return value === null ? null : String(value);
  return value;
}

function eventForChanges(changes) {
  const fields = Object.keys(changes);
  if (fields.length !== 1) return 'task.updated';
  const [field] = fields;
  if (field === 'status') return 'task.status_changed';
  if (field === 'priority') return 'task.priority_changed';
  if (field === 'assigneeId') {
    if (changes[field].to === null) return 'task.unassigned';
    return changes[field].from === null ? 'task.assigned' : 'task.reassigned';
  }
  if (field === 'reporterId') return 'task.reporter_changed';
  return 'task.updated';
}

export async function updateTask(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  if (!isValidBigintId(req.params.taskId)) return next(httpError(404, 'Task not found'));
  try {
    const body = objectBody(req.body);
    if (!body) throw httpError(400, 'Request body must be an object');
    assertKnownKeys(body, TASK_BODY_KEYS, 'task');
    if (Object.keys(body).length === 0) throw httpError(400, 'Provide task details to update');
    const updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === 'title') {
        updates[key] = normalizeTitle(value);
        if (!updates[key]) throw httpError(400, 'Title must be between 1 and 200 characters');
      } else if (key === 'description') {
        updates[key] = normalizeDescription(value);
        if (updates[key] === null) throw httpError(400, 'Description must be at most 10000 characters');
      } else if (key === 'status') {
        updates[key] = parseEnum(value, STATUSES, 'status');
      } else if (key === 'priority') {
        updates[key] = parseEnum(value, PRIORITIES, 'priority');
      } else if (key === 'assigneeId') {
        updates[key] = normalizeId(value, key, { nullable: true });
      } else if (key === 'reporterId') {
        updates[key] = normalizeId(value, key);
      } else if (key === 'dueAt') {
        updates[key] = normalizeDueAt(value);
        if (updates[key] === undefined) throw httpError(400, 'dueAt must be null, a YYYY-MM-DD date, or an ISO date-time');
      } else if (key === 'labels') {
        updates[key] = normalizeLabels(value);
        if (updates[key] === null) throw httpError(400, 'labels must contain at most 20 non-empty strings of at most 40 characters');
      }
    }

    const task = await withTransaction(async (client) => {
      const project = await projectAccess(client, req.params.projectId, req.user.id, { lock: true });
      if (project.archivedAt) throw httpError(409, 'Tasks cannot be updated in an archived project');
      if (Object.hasOwn(updates, 'reporterId') && !['owner', 'admin'].includes(project.role)) {
        throw httpError(403, 'Only workspace owners and admins can change the reporter');
      }
      const currentResult = await client.query(
        `SELECT id::TEXT AS id, title, description, status, priority,
                assignee_id::TEXT AS "assigneeId", reporter_id::TEXT AS "reporterId",
                due_at AS "dueAt", labels, created_by::TEXT AS "createdById"
         FROM tasks WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [req.params.projectId, req.params.taskId],
      );
      if (currentResult.rowCount === 0) throw httpError(404, 'Task not found');
      const current = currentResult.rows[0];
      await ensureWorkspaceMember(client, project.workspaceId, updates.assigneeId, 'assigneeId');
      await ensureWorkspaceMember(client, project.workspaceId, updates.reporterId, 'reporterId');

      const changes = {};
      for (const [field, value] of Object.entries(updates)) {
        const oldValue = comparableTaskValue(field, current[field]);
        const newValue = comparableTaskValue(field, value);
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes[field] = { from: oldValue, to: newValue };
        }
      }
      if (Object.keys(changes).length > 0) {
        const values = [];
        const sets = [];
        for (const [field, change] of Object.entries(changes)) {
          values.push(change.to);
          sets.push(`${TASK_COLUMNS[field]} = $${values.length}`);
        }
        if (changes.status) {
          const bottom = await client.query(
            'SELECT COALESCE(MAX(position), 0) + 1024 AS position FROM tasks WHERE project_id = $1 AND status = $2',
            [req.params.projectId, changes.status.to],
          );
          values.push(bottom.rows[0].position);
          sets.push(`position = $${values.length}`);
        }
        values.push(req.params.taskId, req.params.projectId);
        await client.query(
          `UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
           WHERE id = $${values.length - 1} AND project_id = $${values.length}`,
          values,
        );
        for (const [field, change] of Object.entries(changes)) {
          await insertTaskActivity(
            client,
            project,
            req.user.id,
            eventForChanges({ [field]: change }),
            req.params.taskId,
            { changes: { [field]: change } },
          );
        }
        await notifyTaskEvent(client, {
          actor: req.user,
          workspaceId: project.workspaceId,
          projectId: project.id,
          task: { id: req.params.taskId, title: updates.title ?? current.title },
          after: {
            assigneeId: changes.assigneeId ? changes.assigneeId.to : current.assigneeId,
            reporterId: changes.reporterId ? changes.reporterId.to : current.reporterId,
          },
          changes,
        });
      }
      return readTask(client, req.params.projectId, req.params.taskId);
    });
    await invalidateWorkspaceDashboard(task.workspaceId);
    return res.json({ task });
  } catch (error) {
    return next(error);
  }
}

export async function deleteTask(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  if (!isValidBigintId(req.params.taskId)) return next(httpError(404, 'Task not found'));
  try {
    const workspaceId = await withTransaction(async (client) => {
      const project = await projectAccess(client, req.params.projectId, req.user.id, { lock: true });
      const task = await client.query(
        `SELECT id, title, created_by::TEXT AS "createdById",
                reporter_id::TEXT AS "reporterId", assignee_id::TEXT AS "assigneeId"
         FROM tasks WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [req.params.projectId, req.params.taskId],
      );
      if (task.rowCount === 0) throw httpError(404, 'Task not found');
      const row = task.rows[0];
      const canDelete = ['owner', 'admin'].includes(project.role)
        || String(row.createdById) === String(req.user.id)
        || String(row.reporterId) === String(req.user.id);
      if (!canDelete) throw httpError(403, 'You do not have permission to delete this task');
      await insertTaskActivity(client, project, req.user.id, 'task.deleted', req.params.taskId, {
        title: row.title,
      });
      await client.query('DELETE FROM tasks WHERE project_id = $1 AND id = $2', [
        req.params.projectId,
        req.params.taskId,
      ]);
      await notifyTaskEvent(client, {
        actor: req.user,
        workspaceId: project.workspaceId,
        projectId: project.id,
        task: { id: req.params.taskId, title: row.title },
        after: { assigneeId: row.assigneeId, reporterId: row.reporterId },
        deleted: true,
      });
      return project.workspaceId;
    });
    await invalidateWorkspaceDashboard(workspaceId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export async function listTaskActivity(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  if (!isValidBigintId(req.params.taskId)) return next(httpError(404, 'Task not found'));
  try {
    assertKnownKeys(req.query, new Set(['page', 'limit']), 'query');
    const { page, limit, offset } = parsePagination(req.query);
    await projectAccess(pool, req.params.projectId, req.user.id);
    await readTask(pool, req.params.projectId, req.params.taskId);
    const count = await pool.query(
      `SELECT COUNT(*)::INTEGER AS total
       FROM activity_logs a
       WHERE a.entity_type = 'task' AND a.entity_id = $1`,
      [req.params.taskId],
    );
    const rows = await pool.query(
      `SELECT a.id::TEXT AS id, a.action, a.details, a.created_at AS "createdAt",
              a.actor_id::TEXT AS "actorId", u.display_name AS "actorName"
       FROM activity_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.entity_type = 'task' AND a.entity_id = $1
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $2 OFFSET $3`,
      [req.params.taskId, limit, offset],
    );
    return res.json({
      activity: rows.rows,
      pagination: { page, limit, total: count.rows[0].total, totalPages: Math.ceil(count.rows[0].total / limit) },
    });
  } catch (error) {
    return next(error);
  }
}

const BOARD_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const BOARD_QUERY_KEYS = new Set(['q', 'assigneeId', 'priority', 'limit']);

// GET /api/projects/:projectId/board
// One round trip returns every column: its total and its first `limit` cards in board order.
// Use the task list endpoint (status + sortBy=position + page) to load more of a column.
export async function getBoard(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    assertKnownKeys(req.query, BOARD_QUERY_KEYS, 'query');
    const limit = validPageValue(req.query.limit, 25, 100);
    if (limit === null) throw httpError(400, 'limit must be an integer between 1 and 100');
    const project = await projectAccess(pool, req.params.projectId, req.user.id);

    const filters = ['t.project_id = $1'];
    const values = [req.params.projectId];
    const add = (value, clause) => {
      values.push(value);
      filters.push(clause.replaceAll('?', `$${values.length}`));
    };
    if (req.query.q !== undefined) {
      if (typeof req.query.q !== 'string' || req.query.q.trim().length > 150) throw httpError(400, 'q must be at most 150 characters');
      if (req.query.q.trim()) add(`%${req.query.q.trim()}%`, '(t.title ILIKE ? OR t.description ILIKE ?)');
    }
    if (req.query.priority !== undefined) add(queryEnumList(req.query.priority, PRIORITIES, 'priority'), 't.priority = ANY(?::TEXT[])');
    if (req.query.assigneeId !== undefined) {
      if (req.query.assigneeId === 'unassigned') filters.push('t.assignee_id IS NULL');
      else if (isValidBigintId(req.query.assigneeId)) add(req.query.assigneeId, 't.assignee_id = ?');
      else throw httpError(400, 'assigneeId must be a valid user id or unassigned');
    }
    values.push(limit);

    // Rank inside each column on the narrow index-backed rows first, then join the display
    // columns for only the cards that are returned.
    const result = await pool.query(
      `WITH ranked AS (
         SELECT t.id,
                ROW_NUMBER() OVER (PARTITION BY t.status ORDER BY t.position, t.id) AS rank,
                COUNT(*) OVER (PARTITION BY t.status)::INTEGER AS column_total
         FROM tasks t
         WHERE ${filters.join(' AND ')}
       )
       SELECT ${TASK_COLUMNS_SQL}, r.column_total AS "columnTotal"
       FROM ranked r
       JOIN tasks t ON t.id = r.id
       ${TASK_JOINS_SQL}
       WHERE r.rank <= $${values.length}
       ORDER BY r.rank`,
      values,
    );

    const columns = BOARD_STATUSES.map((status) => ({ status, total: 0, tasks: [] }));
    const byStatus = new Map(columns.map((column) => [column.status, column]));
    for (const { columnTotal, ...task } of result.rows) {
      const column = byStatus.get(task.status);
      column.total = columnTotal;
      column.tasks.push(task);
    }
    return res.json({ columns, limit, archived: Boolean(project.archivedAt) });
  } catch (error) {
    return next(error);
  }
}

const MOVE_BODY_KEYS = new Set(['status', 'afterTaskId']);
const MIN_POSITION_GAP = 1e-6;

// POST /api/projects/:projectId/tasks/:taskId/move   { status, afterTaskId }
// Places the task in column `status` directly after `afterTaskId` (null = top of the column).
// The server derives the stored position from neighbours, so clients never send raw numbers.
// A status change is logged exactly like PATCH; a pure reorder is not an activity event.
export async function moveTask(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  if (!isValidBigintId(req.params.taskId)) return next(httpError(404, 'Task not found'));
  try {
    const body = objectBody(req.body);
    if (!body) throw httpError(400, 'Request body must be an object');
    assertKnownKeys(body, MOVE_BODY_KEYS, 'move');
    const status = parseEnum(body.status, STATUSES, 'status');
    let afterTaskId = null;
    if (body.afterTaskId !== undefined && body.afterTaskId !== null) {
      if (!isValidBigintId(body.afterTaskId)) throw httpError(400, 'afterTaskId must be a valid task id or null');
      afterTaskId = String(body.afterTaskId);
    }
    if (afterTaskId === req.params.taskId) throw httpError(400, 'A task cannot be placed after itself');

    let statusChanged = false;
    const task = await withTransaction(async (client) => {
      // Locks the project row, so concurrent moves in one project are applied one at a time.
      const project = await projectAccess(client, req.params.projectId, req.user.id, { lock: true });
      if (project.archivedAt) throw httpError(409, 'Tasks cannot be moved in an archived project');
      const current = await client.query(
        `SELECT status, title, assignee_id::TEXT AS "assigneeId", reporter_id::TEXT AS "reporterId"
         FROM tasks WHERE project_id = $1 AND id = $2 FOR UPDATE`,
        [req.params.projectId, req.params.taskId],
      );
      if (current.rowCount === 0) throw httpError(404, 'Task not found');
      const previousStatus = current.rows[0].status;

      const neighbours = async () => {
        let prev = null;
        if (afterTaskId !== null) {
          const reference = await client.query(
            'SELECT id::TEXT AS id, position FROM tasks WHERE project_id = $1 AND id = $2 AND status = $3',
            [req.params.projectId, afterTaskId, status],
          );
          if (reference.rowCount === 0) {
            throw httpError(409, 'The card you dropped after has moved or was deleted. Refresh the board and try again.');
          }
          prev = reference.rows[0];
        }
        const next = prev
          ? await client.query(
            `SELECT position FROM tasks
             WHERE project_id = $1 AND status = $2 AND id <> $3 AND (position, id) > ($4::DOUBLE PRECISION, $5::BIGINT)
             ORDER BY position, id LIMIT 1`,
            [req.params.projectId, status, req.params.taskId, prev.position, prev.id],
          )
          : await client.query(
            `SELECT position FROM tasks
             WHERE project_id = $1 AND status = $2 AND id <> $3
             ORDER BY position, id LIMIT 1`,
            [req.params.projectId, status, req.params.taskId],
          );
        return { prev: prev ? prev.position : null, next: next.rowCount ? next.rows[0].position : null };
      };

      let { prev, next } = await neighbours();
      if (prev !== null && next !== null && next - prev < MIN_POSITION_GAP) {
        // Repeated midpoints exhausted the gap: renumber this column once, then retry.
        await client.query(
          `UPDATE tasks t SET position = ranked.rank * 1024
           FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rank
                 FROM tasks WHERE project_id = $1 AND status = $2) ranked
           WHERE ranked.id = t.id`,
          [req.params.projectId, status],
        );
        ({ prev, next } = await neighbours());
      }
      let position;
      if (prev !== null && next !== null) position = (prev + next) / 2;
      else if (prev !== null) position = prev + 1024;
      else if (next !== null) position = next - 1024;
      else position = 1024;

      await client.query(
        // The tasks trigger keeps updated_at unchanged when only position changes (a reorder).
        `UPDATE tasks SET status = $1, position = $2
         WHERE project_id = $3 AND id = $4`,
        [status, position, req.params.projectId, req.params.taskId],
      );
      if (previousStatus !== status) {
        await insertTaskActivity(client, project, req.user.id, 'task.status_changed', req.params.taskId, {
          changes: { status: { from: previousStatus, to: status } },
        });
        await notifyTaskEvent(client, {
          actor: req.user,
          workspaceId: project.workspaceId,
          projectId: project.id,
          task: { id: req.params.taskId, title: current.rows[0].title },
          after: { assigneeId: current.rows[0].assigneeId, reporterId: current.rows[0].reporterId },
          changes: { status: { from: previousStatus, to: status } },
        });
        statusChanged = true;
      }
      return readTask(client, req.params.projectId, req.params.taskId);
    });
    // A pure reorder inside a column changes nothing the dashboard shows.
    if (statusChanged) await invalidateWorkspaceDashboard(task.workspaceId);
    return res.json({ task });
  } catch (error) {
    return next(error);
  }
}
