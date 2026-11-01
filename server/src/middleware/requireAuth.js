import { pool } from '../db/pool.js';
import { hashSessionToken, readCookie, SESSION_COOKIE_NAME } from '../auth/session.js';
import { logger } from '../utils/logger.js';

export async function requireAuth(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  try {
    const result = await pool.query(
      `SELECT u.id::TEXT AS id, u.email, u.display_name AS "displayName", u.email_verified_at IS NOT NULL AS "emailVerified",
              CASE WHEN u.avatar_data IS NOT NULL THEN 'data:' || u.avatar_mime_type || ';base64,' || encode(u.avatar_data, 'base64') ELSE NULL END AS "avatarUrl"
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashSessionToken(token)],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: { message: 'Authentication required' } });
    }

    req.user = result.rows[0];
    req.sessionTokenHash = hashSessionToken(token);
    return next();
  } catch (error) {
    logger.error('Session lookup failed:', error.message);
    return next(error);
  }
}
