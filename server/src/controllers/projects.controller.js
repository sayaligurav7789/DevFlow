import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';
import { isValidBigintId, lockWorkspaceAccess, withTransaction } from '../services/workspaceAccess.service.js';
import { invalidateWorkspaceDashboard } from '../services/cache.service.js';
import { allowlistedValue } from '../utils/allowlist.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECT_SORTS = Object.freeze({
  name: 'p.name',
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
});
const PROJECT_QUERY_KEYS = new Set(['q', 'archived', 'createdById', 'sortBy', 'sortOrder', 'page', 'limit']);
const PROJECT_BODY_KEYS = new Set(['name', 'description', 'slug']);

function objectBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw httpError(400, `Unknown ${label} field: ${unknown}`);
}

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 100 ? name : null;
}

function normalizeDescription(value) {
  if (typeof value !== 'string') return null;
  const description = value.trim();
  return description.length <= 5000 ? description : null;
}

function slugFromName(value) {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function validSlug(value) {
  return typeof value === 'string' && value.length <= 100 && SLUG_PATTERN.test(value);
}

function parsePagination(query) {
  const parse = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= maximum ? number : null;
  };
  const page = parse(query.page, 1, 1_000_000);
  const limit = parse(query.limit, 20, 100);
  if (page === null) {
    throw httpError(400, 'page must be a positive integer');
  }
  if (limit === null) {
    throw httpError(400, 'limit must be an integer between 1 and 100');
  }
  return { page, limit, offset: (page - 1) * limit };
}

function ensureProjectManager(role) {
  if (!['owner', 'admin'].includes(role)) throw httpError(403, 'Only workspace owners and admins can manage projects');
}

function isUniqueViolation(error) {
  return error.code === '23505';
}

function projectRowQuery() {
  return `SELECT p.id::TEXT AS id, p.workspace_id::TEXT AS "workspaceId",
                 p.slug, p.name, p.description, p.archived_at AS "archivedAt",
                 (p.archived_at IS NOT NULL) AS archived,
                 p.created_by::TEXT AS "createdById",
                 p.created_at AS "createdAt", p.updated_at AS "updatedAt"
          FROM projects p`;
}

async function insertProjectActivity(client, workspaceId, actorId, action, projectId, details = {}) {
  await client.query(
    `INSERT INTO activity_logs (workspace_id, actor_id, action, entity_type, entity_id, project_id, details)
     VALUES ($1, $2, $3, 'project', $4, $4, $5::JSONB)`,
    [workspaceId, actorId, action, projectId, JSON.stringify(details)],
  );
}

export async function listProjects(req, res, next) {
  try {
    const query = req.query;
    assertKnownKeys(query, PROJECT_QUERY_KEYS, 'query');
    const { page, limit, offset } = parsePagination(query);
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const sortColumn = allowlistedValue(PROJECT_SORTS, sortBy);
    if (!sortColumn) throw httpError(400, 'sortBy must be name, createdAt, or updatedAt');
    if (!['asc', 'desc'].includes(sortOrder)) throw httpError(400, 'sortOrder must be asc or desc');

    const filters = ['p.workspace_id = $1'];
    const values = [req.workspace.id];
    if (query.archived !== undefined) {
      if (!['true', 'false'].includes(query.archived)) throw httpError(400, 'archived must be true or false');
      values.push(query.archived === 'true');
      filters.push(`(p.archived_at IS NOT NULL) = $${values.length}`);
    } else {
      filters.push('p.archived_at IS NULL');
    }
    if (query.q !== undefined) {
      if (typeof query.q !== 'string' || query.q.trim().length > 100) throw httpError(400, 'q must be at most 100 characters');
      values.push(`%${query.q.trim()}%`);
      filters.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length} OR p.slug ILIKE $${values.length})`);
    }
    if (query.createdById !== undefined) {
      if (!isValidBigintId(query.createdById)) throw httpError(400, 'createdById must be a valid user id');
      values.push(query.createdById);
      filters.push(`p.created_by = $${values.length}`);
    }
    const where = filters.join(' AND ');
    const count = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM projects p WHERE ${where}`, values);
    const rows = await pool.query(
      `${projectRowQuery()}
       WHERE ${where}
       ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}, p.id ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    return res.json({
      projects: rows.rows,
      pagination: { page, limit, total: count.rows[0].total, totalPages: Math.ceil(count.rows[0].total / limit) },
    });
  } catch (error) {
    return next(error);
  }
}

export async function createProject(req, res, next) {
  try {
    const body = objectBody(req.body);
    if (!body) throw httpError(400, 'Request body must be an object');
    assertKnownKeys(body, PROJECT_BODY_KEYS, 'project');
    const name = normalizeName(body.name);
    const description = body.description === undefined ? '' : normalizeDescription(body.description);
    const slug = body.slug === undefined ? slugFromName(name || '') : body.slug.trim().toLowerCase();
    if (!name) throw httpError(400, 'Project name must be between 1 and 100 characters');
    if (description === null) throw httpError(400, 'Description must be at most 5000 characters');
    if (!validSlug(slug)) throw httpError(400, 'Slug must contain lowercase letters, numbers, and hyphens');
    ensureProjectManager(req.workspace.role);

    const project = await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      ensureProjectManager(access.role);
      const result = await client.query(
        `INSERT INTO projects (workspace_id, slug, name, description, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::TEXT AS id`,
        [req.params.workspaceId, slug, name, description, req.user.id],
      );
      const id = result.rows[0].id;
      await insertProjectActivity(client, req.params.workspaceId, req.user.id, 'project.created', id, { name, slug });
      const row = await client.query(`${projectRowQuery()} WHERE p.id = $1`, [id]);
      return row.rows[0];
    });
    await invalidateWorkspaceDashboard(req.params.workspaceId);
    return res.status(201).json({ project });
  } catch (error) {
    if (isUniqueViolation(error)) return next(httpError(409, 'A project with this slug already exists'));
    return next(error);
  }
}

export async function getProject(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    const result = await pool.query(
      `${projectRowQuery()}
       WHERE p.id = $1 AND p.workspace_id = $2`,
      [req.params.projectId, req.params.workspaceId],
    );
    if (result.rowCount === 0) throw httpError(404, 'Project not found');
    return res.json({ project: result.rows[0] });
  } catch (error) {
    return next(error);
  }
}

export async function updateProject(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    const body = objectBody(req.body);
    if (!body) throw httpError(400, 'Request body must be an object');
    assertKnownKeys(body, PROJECT_BODY_KEYS, 'project');
    if (Object.keys(body).length === 0) throw httpError(400, 'Provide project details to update');
    const name = Object.hasOwn(body, 'name') ? normalizeName(body.name) : undefined;
    const description = Object.hasOwn(body, 'description') ? normalizeDescription(body.description) : undefined;
    const slug = Object.hasOwn(body, 'slug')
      ? (typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : null)
      : undefined;
    if (name === null) throw httpError(400, 'Project name must be between 1 and 100 characters');
    if (description === null) throw httpError(400, 'Description must be at most 5000 characters');
    if (slug === null || (slug !== undefined && !validSlug(slug))) {
      throw httpError(400, 'Slug must contain lowercase letters, numbers, and hyphens');
    }
    ensureProjectManager(req.workspace.role);

    const project = await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      ensureProjectManager(access.role);
      const locked = await client.query(
        'SELECT id FROM projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
        [req.params.projectId, req.params.workspaceId],
      );
      if (locked.rowCount === 0) throw httpError(404, 'Project not found');

      const sets = [];
      const values = [];
      for (const [key, column, value] of [
        ['name', 'name', name],
        ['description', 'description', description],
        ['slug', 'slug', slug],
      ]) {
        if (Object.hasOwn(body, key)) {
          values.push(value);
          sets.push(`${column} = $${values.length}`);
        }
      }
      values.push(req.params.projectId, req.params.workspaceId);
      await client.query(
        `UPDATE projects SET ${sets.join(', ')}
         WHERE id = $${values.length - 1} AND workspace_id = $${values.length}`,
        values,
      );
      const row = await client.query(`${projectRowQuery()} WHERE p.id = $1`, [req.params.projectId]);
      await insertProjectActivity(client, req.params.workspaceId, req.user.id, 'project.updated', req.params.projectId, body);
      return row.rows[0];
    });
    await invalidateWorkspaceDashboard(req.params.workspaceId);
    return res.json({ project });
  } catch (error) {
    if (isUniqueViolation(error)) return next(httpError(409, 'A project with this slug already exists'));
    return next(error);
  }
}

async function setProjectArchived(req, res, next, archived) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    ensureProjectManager(req.workspace.role);
    const project = await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      ensureProjectManager(access.role);
      const result = await client.query(
        `UPDATE projects
         SET archived_at = ${archived ? 'COALESCE(archived_at, NOW())' : 'NULL'}
         WHERE id = $1 AND workspace_id = $2
         RETURNING id::TEXT AS id`,
        [req.params.projectId, req.params.workspaceId],
      );
      if (result.rowCount === 0) throw httpError(404, 'Project not found');
      await insertProjectActivity(
        client,
        req.params.workspaceId,
        req.user.id,
        archived ? 'project.archived' : 'project.restored',
        req.params.projectId,
      );
      const row = await client.query(`${projectRowQuery()} WHERE p.id = $1`, [req.params.projectId]);
      return row.rows[0];
    });
    await invalidateWorkspaceDashboard(req.params.workspaceId);
    return res.json({ project });
  } catch (error) {
    return next(error);
  }
}

export function archiveProject(req, res, next) {
  return setProjectArchived(req, res, next, true);
}

export function restoreProject(req, res, next) {
  return setProjectArchived(req, res, next, false);
}

export async function deleteProject(req, res, next) {
  if (!isValidBigintId(req.params.projectId)) return next(httpError(404, 'Project not found'));
  try {
    ensureProjectManager(req.workspace.role);
    await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      ensureProjectManager(access.role);
      const project = await client.query(
        'SELECT id, name FROM projects WHERE id = $1 AND workspace_id = $2 FOR UPDATE',
        [req.params.projectId, req.params.workspaceId],
      );
      if (project.rowCount === 0) throw httpError(404, 'Project not found');
      await insertProjectActivity(client, req.params.workspaceId, req.user.id, 'project.deleted', req.params.projectId, {
        name: project.rows[0].name,
      });
      await client.query('DELETE FROM projects WHERE id = $1 AND workspace_id = $2', [
        req.params.projectId,
        req.params.workspaceId,
      ]);
    });
    await invalidateWorkspaceDashboard(req.params.workspaceId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
