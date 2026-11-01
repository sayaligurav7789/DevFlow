import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { createSessionToken, hashSessionToken, SESSION_TTL_MS } from '../auth/session.js';

const BCRYPT_ROUNDS = 12;
const TOKEN_TTL = Object.freeze({ verify_email: 24 * 60 * 60 * 1000, reset_password: 60 * 60 * 1000, change_email: 60 * 60 * 1000 });
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export async function createAccountActionToken({ userId, purpose, pendingEmail = null }) {
  const token = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM account_action_tokens WHERE expires_at <= NOW() OR consumed_at IS NOT NULL');
  await pool.query('DELETE FROM account_action_tokens WHERE user_id = $1 AND purpose = $2', [userId, purpose]);
  await pool.query(
    `INSERT INTO account_action_tokens (token_hash, user_id, purpose, pending_email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashToken(token), userId, purpose, pendingEmail, new Date(Date.now() + TOKEN_TTL[purpose])],
  );
  return token;
}

export async function consumeAccountActionToken(token, purpose) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await pool.query(
    `UPDATE account_action_tokens SET consumed_at = NOW()
     WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING user_id::TEXT AS user_id, pending_email`,
    [hashToken(token), purpose],
  );
  return result.rows[0] || null;
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const row = found.rows[0];
    if (!row?.password_hash || !(await bcrypt.compare(currentPassword, row.password_hash))) {
      await client.query('ROLLBACK');
      return null;
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    const token = createSessionToken();
    await client.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashSessionToken(token), userId, new Date(Date.now() + SESSION_TTL_MS)]);
    await client.query('COMMIT');
    return token;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function updatePasswordFromReset(userId, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM account_action_tokens WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function verifyEmailToken(token) {
  const action = await consumeAccountActionToken(token, 'verify_email');
  if (!action) return false;
  await pool.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1', [action.user_id]);
  return true;
}

export async function completeEmailChange(token) {
  const action = await consumeAccountActionToken(token, 'change_email');
  if (!action?.pending_email) return false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE users SET email = $1, pending_email = NULL, email_verified_at = NOW()
       WHERE id = $2 AND pending_email = $1`,
      [action.pending_email, action.user_id],
    );
    if (result.rowCount !== 1) { await client.query('ROLLBACK'); return false; }
    await client.query('DELETE FROM sessions WHERE user_id = $1', [action.user_id]);
    await client.query('COMMIT');
    return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
