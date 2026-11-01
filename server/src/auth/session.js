import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';

export const SESSION_COOKIE_NAME = 'devflow_session';
export const CSRF_COOKIE_NAME = 'devflow_csrf';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;

    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/api',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/api',
  });
}

export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
  });
}
