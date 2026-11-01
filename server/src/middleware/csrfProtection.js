import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { CSRF_COOKIE_NAME, readCookie, SESSION_TTL_SECONDS } from '../auth/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfSignature(nonce) {
  return createHmac('sha256', config.sessionSecret)
    .update(`devflow-csrf-v1:${nonce}`)
    .digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCsrfToken() {
  const nonce = randomBytes(32).toString('base64url');
  return `${nonce}.${csrfSignature(nonce)}`;
}

export function isValidCsrfToken(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parts[0])) return false;

  return safeEqual(parts[1], csrfSignature(parts[0]));
}

export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = readCookie(req, CSRF_COOKIE_NAME);
  const headerToken = req.get('x-csrf-token');
  if (
    !cookieToken
    || !headerToken
    || !safeEqual(cookieToken, headerToken)
    || !isValidCsrfToken(cookieToken)
  ) {
    return res.status(403).json({ error: { message: 'Invalid or missing CSRF token' } });
  }

  return next();
}
