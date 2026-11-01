import { pool } from '../db/pool.js';
import { isValidBigintId } from '../services/workspaceAccess.service.js';
import { logger } from '../utils/logger.js';

export async function requireWorkspaceAccess(req, res, next) {
  const { workspaceId } = req.params;
  if (!isValidBigintId(workspaceId)) {
    return res.status(404).json({ error: { message: 'Workspace not found' } });
  }

  try {
    const result = await pool.query(
      `SELECT w.id::TEXT AS id, w.slug, w.name, w.description, w.settings,
              wm.role, w.created_at AS "createdAt", w.updated_at AS "updatedAt",
              (SELECT COUNT(*)::INTEGER FROM workspace_members members
               WHERE members.workspace_id = w.id) AS "memberCount"
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE w.id = $1 AND wm.user_id = $2`,
      [workspaceId, req.user.id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: { message: 'Workspace not found' } });
    }
    req.workspace = result.rows[0];
    return next();
  } catch (error) {
    logger.error('Workspace authorization lookup failed:', error.message);
    return next(error);
  }
}
