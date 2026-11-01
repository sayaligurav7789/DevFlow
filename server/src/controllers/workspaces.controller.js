import { pool } from '../db/pool.js';
import { httpError } from '../utils/httpError.js';
import {
  isValidBigintId,
  lockWorkspaceAccess,
  withTransaction,
} from '../services/workspaceAccess.service.js';
import { invalidateWorkspaceDashboard } from '../services/cache.service.js';
import { deleteUserWorkspaceNotifications } from '../services/notifications.service.js';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function bodyObject(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 80 ? name : null;
}

function normalizeDescription(value) {
  if (typeof value !== 'string') return null;
  const description = value.trim();
  return description.length <= 1000 ? description : null;
}

function slugFromName(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'allowMemberInvites' || typeof value.allowMemberInvites !== 'boolean') {
    return null;
  }
  return { allowMemberInvites: value.allowMemberInvites };
}

function requireRole(req, res, roles) {
  if (!roles.includes(req.workspace.role)) {
    res.status(403).json({ error: { message: 'You do not have permission to do that' } });
    return false;
  }
  return true;
}

function isUniqueViolation(error) {
  return error.code === '23505';
}

export async function listWorkspaces(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT w.id::TEXT AS id, w.slug, w.name, w.description, w.settings,
              wm.role, w.created_at AS "createdAt", w.updated_at AS "updatedAt",
              (SELECT COUNT(*)::INTEGER FROM workspace_members members
               WHERE members.workspace_id = w.id) AS "memberCount"
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = $1
       ORDER BY w.name, w.id`,
      [req.user.id],
    );
    res.json({ workspaces: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function createWorkspace(req, res, next) {
  const body = bodyObject(req);
  const name = normalizeName(body.name);
  const description = body.description === undefined ? '' : normalizeDescription(body.description);
  const slugInput = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : null;

  if (!name) return res.status(400).json({ error: { message: 'Workspace name must be between 1 and 80 characters' } });
  if (description === null) return res.status(400).json({ error: { message: 'Description must be at most 1000 characters' } });
  if (slugInput !== null && !SLUG_PATTERN.test(slugInput)) {
    return res.status(400).json({ error: { message: 'Slug must contain lowercase letters, numbers, and hyphens' } });
  }

  const slug = slugInput || slugFromName(name);
  if (!slug) return res.status(400).json({ error: { message: 'Workspace name must produce a valid slug' } });

  try {
    const workspace = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO workspaces (slug, name, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id::TEXT AS id, slug, name, description, settings,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [slug, name, description, req.user.id],
      );
      const row = inserted.rows[0];
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [row.id, req.user.id],
      );
      return { ...row, role: 'owner', memberCount: 1 };
    });
    return res.status(201).json({ workspace });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: { message: 'A workspace with this slug already exists' } });
    }
    return next(error);
  }
}

export function getWorkspace(req, res) {
  res.json({ workspace: req.workspace });
}

export async function updateWorkspace(req, res, next) {
  const body = bodyObject(req);
  const hasName = Object.hasOwn(body, 'name');
  const hasDescription = Object.hasOwn(body, 'description');
  const hasSettings = Object.hasOwn(body, 'settings');
  const name = hasName ? normalizeName(body.name) : null;
  const description = hasDescription ? normalizeDescription(body.description) : null;
  const settings = hasSettings ? validateSettings(body.settings) : null;

  if (!hasName && !hasDescription && !hasSettings) {
    return res.status(400).json({ error: { message: 'Provide workspace details to update' } });
  }
  if (hasName && !name) return res.status(400).json({ error: { message: 'Workspace name must be between 1 and 80 characters' } });
  if (hasDescription && description === null) {
    return res.status(400).json({ error: { message: 'Description must be at most 1000 characters' } });
  }
  if (hasSettings && !settings) {
    return res.status(400).json({ error: { message: 'Only the allowMemberInvites boolean setting is supported' } });
  }
  if (!requireRole(req, res, ['owner', 'admin'])) return undefined;
  if (hasSettings && req.workspace.role !== 'owner') {
    return res.status(403).json({ error: { message: 'Only the workspace owner can change invitation settings' } });
  }

  try {
    const workspace = await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      if (!['owner', 'admin'].includes(access.role)) throw httpError(403, 'You do not have permission to do that');
      if (hasSettings && access.role !== 'owner') {
        throw httpError(403, 'Only the workspace owner can change invitation settings');
      }

      const mergedSettings = hasSettings
        ? JSON.stringify({ ...access.settings, ...settings })
        : null;
      const result = await client.query(
        `UPDATE workspaces
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             settings = COALESCE($3::JSONB, settings),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id::TEXT AS id, slug, name, description, settings,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [name, description, mergedSettings, req.params.workspaceId],
      );
      return { ...result.rows[0], role: access.role };
    });
    return res.json({ workspace });
  } catch (error) {
    return next(error);
  }
}

export async function deleteWorkspace(req, res, next) {
  if (!requireRole(req, res, ['owner'])) return undefined;

  try {
    await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      if (access.role !== 'owner') throw httpError(403, 'Only the workspace owner can delete it');
      await client.query('DELETE FROM workspaces WHERE id = $1', [req.params.workspaceId]);
    });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export async function listWorkspaceMembers(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT u.id::TEXT AS id, u.email, u.display_name AS "displayName",
              wm.role, wm.joined_at AS "joinedAt"
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                u.display_name, u.id`,
      [req.params.workspaceId],
    );
    res.json({ members: result.rows });
  } catch (error) {
    next(error);
  }
}

export async function updateMemberRole(req, res, next) {
  if (!requireRole(req, res, ['owner'])) return undefined;
  const { userId } = req.params;
  const { role } = bodyObject(req);
  if (!isValidBigintId(userId)) return res.status(404).json({ error: { message: 'Member not found' } });
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: { message: 'Role must be admin or member' } });
  }

  try {
    const member = await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      if (access.role !== 'owner') throw httpError(403, 'Only the workspace owner can change member roles');
      const existing = await client.query(
        `SELECT user_id::TEXT AS id, role
         FROM workspace_members
         WHERE workspace_id = $1 AND user_id = $2
         FOR UPDATE`,
        [req.params.workspaceId, userId],
      );
      if (existing.rowCount === 0) throw httpError(404, 'Member not found');
      if (existing.rows[0].role === 'owner') throw httpError(409, 'The workspace owner role cannot be changed');

      const updated = await client.query(
        `UPDATE workspace_members
         SET role = $1
         WHERE workspace_id = $2 AND user_id = $3
         RETURNING user_id::TEXT AS id, role, joined_at AS "joinedAt"`,
        [role, req.params.workspaceId, userId],
      );
      const user = await client.query(
        'SELECT email, display_name AS "displayName" FROM users WHERE id = $1',
        [userId],
      );
      return { ...updated.rows[0], ...user.rows[0] };
    });
    return res.json({ member });
  } catch (error) {
    return next(error);
  }
}

export async function removeWorkspaceMember(req, res, next) {
  const { userId } = req.params;
  if (!isValidBigintId(userId)) return res.status(404).json({ error: { message: 'Member not found' } });

  try {
    await withTransaction(async (client) => {
      const access = await lockWorkspaceAccess(client, req.params.workspaceId, req.user.id);
      if (!access) throw httpError(404, 'Workspace not found');
      const existing = await client.query(
        `SELECT user_id::TEXT AS id, role
         FROM workspace_members
         WHERE workspace_id = $1 AND user_id = $2
         FOR UPDATE`,
        [req.params.workspaceId, userId],
      );
      if (existing.rowCount === 0) throw httpError(404, 'Member not found');

      const target = existing.rows[0];
      const isSelf = String(req.user.id) === String(userId);
      if (target.role === 'owner') throw httpError(409, 'The workspace owner cannot be removed');
      const canRemove = access.role === 'owner'
        || (access.role === 'admin' && (target.role === 'member' || isSelf))
        || (access.role === 'member' && isSelf);
      if (!canRemove) throw httpError(403, 'You do not have permission to remove this member');

      await client.query(
        `WITH unassigned AS (
           UPDATE tasks t
           SET assignee_id = NULL
           FROM projects p
           WHERE t.project_id = p.id
             AND p.workspace_id = $1
             AND t.assignee_id = $2
           RETURNING t.id, t.project_id
         )
         INSERT INTO activity_logs (workspace_id, actor_id, action, entity_type, entity_id, project_id, details)
         SELECT $1, $3, 'task.unassigned', 'task', unassigned.id, unassigned.project_id,
                jsonb_build_object('assigneeId', $2::TEXT, 'reason', 'member_removed')
         FROM unassigned`,
        [req.params.workspaceId, userId, req.user.id],
      );
      await client.query(
        'DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [req.params.workspaceId, userId],
      );
      // They lose access to this workspace's task titles, so their notifications for it go too.
      await deleteUserWorkspaceNotifications(client, req.params.workspaceId, userId);
    });
    await invalidateWorkspaceDashboard(req.params.workspaceId);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
