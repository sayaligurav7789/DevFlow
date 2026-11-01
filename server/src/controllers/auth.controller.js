import { pool } from '../db/pool.js';
import {
  authenticateUser,
  registerUser,
  updateUserProfile,
} from '../services/auth.service.js';
import {
  clearCsrfCookie,
  clearSessionCookie,
  hashSessionToken,
  readCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '../auth/session.js';
import { createCsrfToken, setCsrfCookie } from '../middleware/csrfProtection.js';
import { logger } from '../utils/logger.js';
import bcrypt from 'bcrypt';
import { config } from '../config/env.js';
import { sendAccountEmail } from '../email.js';
import {
  createAccountActionToken, changePassword as changePasswordService,
  updatePasswordFromReset, verifyEmailToken, completeEmailChange,
} from '../services/accountSecurity.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

function requestBody(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const displayName = value.trim();
  return displayName.length > 0 && displayName.length <= 80 ? displayName : null;
}

function invalid(res, message) {
  return res.status(400).json({ error: { message } });
}

function isDuplicateEmail(error) {
  return error.code === '23505' && error.constraint === 'users_email_key';
}

export function getCsrfToken(req, res) {
  const csrfToken = createCsrfToken();
  setCsrfCookie(res, csrfToken);
  res.status(204).end();
}

export async function register(req, res, next) {
  const body = requestBody(req);
  const email = normalizeEmail(body.email);
  const displayName = normalizeDisplayName(body.displayName);
  const password = body.password;

  if (!email) return invalid(res, 'Enter a valid email address');
  if (!displayName) return invalid(res, 'Display name must be between 1 and 80 characters');
  if (typeof password !== 'string' || password.length < 12) {
    return invalid(res, 'Password must contain at least 12 characters');
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) {
    return invalid(res, 'Password must be at most 72 UTF-8 bytes');
  }

  try {
    const result = await registerUser({ email, displayName, password });
    setSessionCookie(res, result.token);
    try {
      const token = await createAccountActionToken({ userId: result.user.id, purpose: 'verify_email' });
      await sendAccountEmail({ to: email, subject: 'Verify your DevFlow email', heading: 'Verify your email address', message: 'Confirm your email address to secure your DevFlow account.', actionLabel: 'Verify email', actionUrl: `${config.clientOrigin}/verify-email?token=${token}`, expiryText: 'This link expires in 24 hours.' });
    } catch (emailError) { logger.error('Verification email could not be sent:', emailError.message); }
    return res.status(201).json({ user: result.user });
  } catch (error) {
    if (isDuplicateEmail(error)) {
      return res.status(409).json({ error: { message: 'An account with this email already exists' } });
    }
    return next(error);
  }
}

export async function login(req, res, next) {
  const body = requestBody(req);
  const email = normalizeEmail(body.email);
  const password = body.password;

  if (!email || typeof password !== 'string' || password.length === 0) {
    return invalid(res, 'Enter a valid email address and password');
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) {
    return res.status(401).json({ error: { message: 'Invalid email or password' } });
  }

  try {
    const result = await authenticateUser({ email, password });
    if (!result) {
      return res.status(401).json({ error: { message: 'Invalid email or password' } });
    }
    setSessionCookie(res, result.token);
    return res.json({ user: result.user });
  } catch (error) {
    return next(error);
  }
}

export async function logout(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE_NAME);
  try {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    }
    clearSessionCookie(res);
    clearCsrfCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

export function getCurrentUser(req, res) {
  res.json({ user: req.user });
}

export async function updateCurrentUser(req, res, next) {
  const body = requestBody(req);
  const hasEmail = Object.hasOwn(body, 'email');
  const hasDisplayName = Object.hasOwn(body, 'displayName');
  if (hasEmail) return invalid(res, 'Use the secure email-change flow to update your email address');

  if (!hasEmail && !hasDisplayName) {
    return invalid(res, 'Provide an email address or display name to update');
  }

  const email = hasEmail ? normalizeEmail(body.email) : null;
  const displayName = hasDisplayName ? normalizeDisplayName(body.displayName) : null;
  if (hasEmail && !email) return invalid(res, 'Enter a valid email address');
  if (hasDisplayName && !displayName) {
    return invalid(res, 'Display name must be between 1 and 80 characters');
  }

  try {
    const user = await updateUserProfile(req.user.id, { email, displayName });
    if (!user) return res.status(401).json({ error: { message: 'Authentication required' } });
    return res.json({ user });
  } catch (error) {
    if (isDuplicateEmail(error)) {
      return res.status(409).json({ error: { message: 'An account with this email already exists' } });
    }
    logger.error('Profile update failed:', error.message);
    return next(error);
  }
}

// Account security actions. Tokens are random, single-use, stored only as SHA-256 hashes.


function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password, 'utf8') <= MAX_BCRYPT_PASSWORD_BYTES;
}

export async function changePassword(req, res, next) {
  const { currentPassword, newPassword } = requestBody(req);
  if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES || !validPassword(newPassword)) {
    return invalid(res, 'Enter your current password and a new password of 12–72 UTF-8 bytes');
  }
  if (currentPassword === newPassword) return invalid(res, 'Choose a password different from your current password');
  try {
    const token = await changePasswordService({ userId: req.user.id, currentPassword, newPassword });
    if (!token) return res.status( currentPassword ? 401 : 400).json({ error: { message: 'Current password is incorrect' } });
    setSessionCookie(res, token);
    return res.json({ ok: true, message: 'Password changed. Other sessions have been signed out.' });
  } catch (error) { return next(error); }
}

export async function signOutEverywhere(req, res, next) {
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);
    clearSessionCookie(res);
    clearCsrfCookie(res);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
}

export async function requestPasswordReset(req, res, next) {
  const email = normalizeEmail(requestBody(req).email);
  if (!email) return invalid(res, 'Enter a valid email address');
  try {
    const found = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (found.rowCount) {
      const token = await createAccountActionToken({ userId: found.rows[0].id, purpose: 'reset_password' });
      try { await sendAccountEmail({ to: email, subject: 'Reset your DevFlow password', heading: 'Reset your password', message: 'We received a request to reset your DevFlow password.', actionLabel: 'Reset password', actionUrl: `${config.clientOrigin}/reset-password?token=${token}`, expiryText: 'This link expires in 1 hour.' }); } catch (mailError) { logger.error('Password reset email could not be sent:', mailError.message); }
    }
    return res.json({ ok: true, message: 'If an account exists for that email, a password reset link has been sent.' });
  } catch (error) { return next(error); }
}

export async function resetPassword(req, res, next) {
  const { token, newPassword } = requestBody(req);
  if (!validPassword(newPassword)) return invalid(res, 'Password must contain 12–72 UTF-8 bytes');
  try {
    const action = await (await import('../services/accountSecurity.service.js')).consumeAccountActionToken(token, 'reset_password');
    if (!action) return res.status(400).json({ error: { message: 'This password reset link is invalid or has expired' } });
    await updatePasswordFromReset(action.user_id, newPassword);
    return res.json({ ok: true, message: 'Password reset successfully. Please sign in again.' });
  } catch (error) { return next(error); }
}

export async function resendEmailVerification(req, res, next) {
  try {
    const found = await pool.query('SELECT email, email_verified_at FROM users WHERE id = $1', [req.user.id]);
    if (!found.rows[0]) return res.status(404).json({ error: { message: 'Account not found' } });
    if (found.rows[0].email_verified_at) return res.json({ ok: true, message: 'Email is already verified.' });
    const token = await createAccountActionToken({ userId: req.user.id, purpose: 'verify_email' });
    await sendAccountEmail({ to: found.rows[0].email, subject: 'Verify your DevFlow email', heading: 'Verify your email address', message: 'Confirm your email address to secure your DevFlow account.', actionLabel: 'Verify email', actionUrl: `${config.clientOrigin}/verify-email?token=${token}`, expiryText: 'This link expires in 24 hours.' });
    return res.json({ ok: true, message: 'Verification email sent.' });
  } catch (error) { return next(error); }
}

export async function verifyEmail(req, res, next) {
  try {
    const token = requestBody(req).token;
    const verified = await verifyEmailToken(token);
    const changed = verified ? false : await completeEmailChange(token);
    if (!verified && !changed) return res.status(400).json({ error: { message: 'This verification link is invalid or has expired' } });
    return res.json({ ok: true, message: changed ? 'Email address updated successfully.' : 'Email verified successfully.' });
  } catch (error) { return next(error); }
}

export async function requestEmailChange(req, res, next) {
  const { email: rawEmail, currentPassword } = requestBody(req);
  const email = normalizeEmail(rawEmail);
  if (!email || typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword, 'utf8') > MAX_BCRYPT_PASSWORD_BYTES) return invalid(res, 'Enter a valid new email address and your current password');
  try {
    const found = await pool.query('SELECT email, password_hash FROM users WHERE id = $1', [req.user.id]);
    const account = found.rows[0];
    if (!account?.password_hash || !(await bcrypt.compare(currentPassword, account.password_hash))) {
      return res.status(401).json({ error: { message: 'Current password is incorrect' } });
    }
    if (email === account.email) return invalid(res, 'That is already your current email address');
    const conflict = await pool.query('SELECT 1 FROM users WHERE (email = $1 OR pending_email = $1) AND id <> $2', [email, req.user.id]);
    if (conflict.rowCount) return res.status(409).json({ error: { message: 'That email address is already in use or pending verification' } });
    await pool.query('UPDATE users SET pending_email = $1 WHERE id = $2', [email, req.user.id]);
    await pool.query("DELETE FROM account_action_tokens WHERE user_id = $1 AND purpose = 'change_email'", [req.user.id]);
    const token = await createAccountActionToken({ userId: req.user.id, purpose: 'change_email', pendingEmail: email });
    await sendAccountEmail({ to: email, subject: 'Confirm your new DevFlow email', heading: 'Confirm your new email address', message: 'A request was made to change the email address on your DevFlow account.', actionLabel: 'Confirm new email', actionUrl: `${config.clientOrigin}/verify-email?token=${token}`, expiryText: 'This link expires in 1 hour. Your email will not change until you confirm it.' });
    return res.json({ ok: true, message: 'Confirmation sent to your new email address.' });
  } catch (error) {
    if (error.code === '23505' && ['users_email_key', 'users_pending_email_unique'].includes(error.constraint)) return res.status(409).json({ error: { message: 'That email address is already in use' } });
    return next(error);
  }
}

export async function confirmEmailChange(req, res, next) {
  try {
    const ok = await completeEmailChange(requestBody(req).token);
    if (!ok) return res.status(400).json({ error: { message: 'This email confirmation link is invalid or has expired' } });
    return res.json({ ok: true, message: 'Email address updated successfully. Sign in again if prompted.' });
  } catch (error) { return next(error); }
}


const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function getProfilePhoto(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT avatar_data, avatar_mime_type
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    const user = result.rows[0];

    if (!user?.avatar_data) {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', user.avatar_mime_type);
    res.setHeader('Cache-Control', 'private, no-cache');

    return res.send(user.avatar_data);
  } catch (error) {
    return next(error);
  }
}

export async function updateProfilePhoto(req, res, next) {
  const { imageData } = requestBody(req);
  if (typeof imageData !== 'string') return invalid(res, 'Choose a profile photo to upload');
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !PROFILE_PHOTO_TYPES.has(match[1])) return invalid(res, 'Upload a JPG, PNG, or WebP image');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > PROFILE_PHOTO_MAX_BYTES || buffer.toString('base64') !== match[2]) return invalid(res, 'Profile photo must be 2 MB or smaller and contain valid image data');
  try {
    await pool.query('UPDATE users SET avatar_data = $1, avatar_mime_type = $2 WHERE id = $3', [buffer, match[1], req.user.id]);
    return res.json({ ok: true, message: 'Profile photo updated' });
  } catch (error) { return next(error); }
}

export async function removeProfilePhoto(req, res, next) {
  try {
    await pool.query('UPDATE users SET avatar_data = NULL, avatar_mime_type = NULL WHERE id = $1', [req.user.id]);
    return res.json({ ok: true, message: 'Profile photo removed' });
  } catch (error) { return next(error); }
}
