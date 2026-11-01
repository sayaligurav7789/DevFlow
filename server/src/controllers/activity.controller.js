import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';
import { assertKnownKeys, parsePagination } from '../utils/queryParams.js';
import { isValidBigintId } from '../services/workspaceAccess.service.js';

const ENTITY_TYPES = new Set(['task', 'project', 'member', 'workspace']);
const DEFAULT_ENTITY_TYPES = ['task', 'project'];
const WORKSPACE_FEED_KEYS = new Set(['entityType', 'projectId', 'actorId', 'page', 'limit']);
const PROJECT_FEED_KEYS = new Set(['page', 'limit']);

// Each feed row: who (actor), what (action), on which entity, and when. Entity names are read
// from the live row when it still exists and fall back to the snapshot stored in `details`
// (task.created / task.deleted / project.created / project.deleted keep a title or name).
const ACTIVITY_SELECT = `
  SELECT a.id::TEXT AS id, a.action,
         a.entity_type AS "entityType", a.entity_id::TEXT AS "entityId",
         COALESCE(t.title, pr.name, a.details->>'title', a.details->>'name') AS "entityName",
         a.project_id::TEXT AS "projectId", p.name AS "projectName",
         a.actor_id::TEXT AS "actorId", u.display_name AS "actorName",
         a.details, a.created_at AS "createdAt"
  FROM activity_logs a
  LEFT JOIN users u ON u.id = a.actor_id
  LEFT JOIN tasks t ON a.entity_type = 'task' AND t.id = a.entity_id
  LEFT JOIN projects pr ON a.entity_type = 'project' AND pr.id = a.entity_id
  LEFT JOIN projects p ON p.id = a.project_id`;

// Newest first; id breaks ties because every event written in one transaction shares a timestamp.
const ACTIVITY_ORDER = 'ORDER BY a.created_at DESC, a.id DESC';

function entityTypeFilter(value) {
  if (value === undefined) return DEFAULT_ENTITY_TYPES;
  if (typeof value !== 'string' || value.length > 100) throw httpError(400, 'entityType is invalid');
  const types = [...new Set(value.split(',').map((item) => item.trim()))];
  if (types.length === 0 || types.some((type) => !ENTITY_TYPES.has(type))) {
    throw httpError(400, 'entityType must be a comma-separated list of task, project, member, workspace');
  }
  return types;
}

// Shared by the workspace feed endpoint and the dashboard's "recent activity" list.
export async function queryWorkspaceActivity(queryable, workspaceId, { entityTypes = DEFAULT_ENTITY_TYPES, projectId, actorId, limit, offset = 0, withTotal = false }) {
  const where = ['a.workspace_id = $1', 'a.entity_type = ANY($2::TEXT[])'];
  const values = [workspaceId, entityTypes];
  if (projectId !== undefined) { values.push(projectId); where.push(`a.project_id = $${values.length}`); }
  if (actorId !== undefined) { values.push(actorId); where.push(`a.actor_id = $${values.length}`); }
  const rowsQuery = queryable.query(
    `${ACTIVITY_SELECT} WHERE ${where.join(' AND ')} ${ACTIVITY_ORDER} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, offset],
  );
  if (!withTotal) return { rows: (await rowsQuery).rows };
  const [rows, count] = await Promise.all([
    rowsQuery,
    queryable.query(`SELECT COUNT(*)::INTEGER AS total FROM activity_logs a WHERE ${where.join(' AND ')}`, values),
  ]);
  return { rows: rows.rows, total: count.rows[0].total };
}

function pageResponse(res, rows, total, { page, limit }) {
  return res.json({ activity: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

// GET /api/workspaces/:workspaceId/activity - membership enforced by requireWorkspaceAccess.
export async function listWorkspaceActivity(req, res, next) {
  try {
    assertKnownKeys(req.query, WORKSPACE_FEED_KEYS);
    const pagination = parsePagination(req.query);
    const entityTypes = entityTypeFilter(req.query.entityType);
    for (const key of ['projectId', 'actorId']) {
      if (req.query[key] !== undefined && !isValidBigintId(req.query[key])) throw httpError(400, `${key} must be a valid id`);
    }
    const { rows, total } = await queryWorkspaceActivity(pool, req.workspace.id, {
      entityTypes, projectId: req.query.projectId, actorId: req.query.actorId,
      limit: pagination.limit, offset: pagination.offset, withTotal: true,
    });
    return pageResponse(res, rows, total, pagination);
  } catch (error) {
    return next(error);
  }
}

// GET /api/projects/:projectId/activity - project events plus the history of its tasks.
export async function listProjectActivity(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    assertKnownKeys(req.query, PROJECT_FEED_KEYS);
    const pagination = parsePagination(req.query);
    // Membership check; outsiders get the same 404 as a missing project.
    const access = await pool.query(
      `SELECT 1
       FROM projects p JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
       WHERE p.id = $1 AND wm.user_id = $2`,
      [req.params.projectId, req.user.id],
    );
    if (access.rowCount === 0) throw httpError(404, 'Project not found');
    // A project belongs to exactly one workspace and the membership check above already covers it,
    // so project_id alone is the filter. (A redundant workspace_id predicate made the planner
    // intersect two bitmap scans and read the project's whole history to return one page.)
    const where = 'a.project_id = $1';
    const values = [req.params.projectId];
    const [rows, count] = await Promise.all([
      pool.query(`${ACTIVITY_SELECT} WHERE ${where} ${ACTIVITY_ORDER} LIMIT $2 OFFSET $3`, [...values, pagination.limit, pagination.offset]),
      pool.query(`SELECT COUNT(*)::INTEGER AS total FROM activity_logs a WHERE ${where}`, values),
    ]);
    return pageResponse(res, rows.rows, count.rows[0].total, pagination);
  } catch (error) {
    return next(error);
  }
}
