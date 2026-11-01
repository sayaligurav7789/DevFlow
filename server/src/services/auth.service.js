import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { createSessionToken, hashSessionToken, SESSION_TTL_MS } from '../auth/session.js';

const BCRYPT_ROUNDS = 12;
const dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

function publicUser(row, includeVerification = true) {
  return {
    id: String(row.id),
    email: row.email,
    displayName: row.display_name,
    ...(includeVerification ? { emailVerified: Boolean(row.email_verified_at) } : {}),
    avatarUrl: row.avatar_url ? `data:${row.avatar_mime_type};base64,${row.avatar_url}` : null,
  };
}

async function insertSession(client, userId) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await client.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  await client.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, userId, expiresAt],
  );
  return token;
}

export async function registerUser({ email, displayName, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, email_verified_at, avatar_mime_type, encode(avatar_data, 'base64') AS avatar_url`,
      [email, displayName, passwordHash],
    );
    const token = await insertSession(client, result.rows[0].id);
    await client.query('COMMIT');
    return { user: publicUser(result.rows[0], false), token };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateUser({ email, password }) {
  const result = await pool.query(
    `SELECT id, email, display_name, password_hash, email_verified_at,
     avatar_mime_type, encode(avatar_data, 'base64') AS avatar_url
     FROM users WHERE email = $1`,
     [email],
  );
  const row = result.rows[0];
  const hash = row?.password_hash || await dummyPasswordHash;
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!row || !row.password_hash || !passwordMatches) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = await insertSession(client, row.id);
    await client.query('COMMIT');
    return { user: publicUser(row), token };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUserProfile(userId, { email, displayName }) {
  const result = await pool.query(
    `UPDATE users
     SET email = COALESCE($1, email),
         display_name = COALESCE($2, display_name)
     WHERE id = $3
     RETURNING id, email, display_name, email_verified_at, avatar_mime_type, encode(avatar_data, 'base64') AS avatar_url`,
    [email, displayName, userId],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}
