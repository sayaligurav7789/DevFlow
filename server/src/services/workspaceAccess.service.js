import { pool } from '../db/pool.js';

export function isValidBigintId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) return false;
  try {
    return BigInt(value) <= 9223372036854775807n;
  } catch {
    return false;
  }
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database or validation error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function lockWorkspaceAccess(client, workspaceId, userId) {
  const result = await client.query(
    `SELECT w.id::TEXT AS id, w.slug, w.name, w.description, w.settings,
            wm.role, w.created_at AS "createdAt", w.updated_at AS "updatedAt"
     FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE w.id = $1 AND wm.user_id = $2
     FOR UPDATE OF w`,
    [workspaceId, userId],
  );
  return result.rows[0] || null;
}
