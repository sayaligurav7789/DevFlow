// Behaviour that only exists when NODE_ENV=production. The environment is set before anything is
// imported because config is frozen at import time. No database or HTTP server is needed.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = `production-test-${'x'.repeat(40)}`;
delete process.env.CLIENT_ORIGIN;
delete process.env.DEVFLOW_DB_PASSWORD;
delete process.env.DEVFLOW_ALLOW_PRODUCTION_SEED;

const [{ config }, { getHealthStatus }, session, csrf, { errorHandler }, { securityHeaders }, { seedDatabase }, { createApp }] = await Promise.all([
  import('../src/config/env.js'),
  import('../src/services/health.service.js'),
  import('../src/auth/session.js'),
  import('../src/middleware/csrfProtection.js'),
  import('../src/middleware/errorHandler.js'),
  import('../src/middleware/securityHeaders.js'),
  import('../src/db/seed.js'),
  import('../src/app.js'),
]);

const mockRes = () => {
  const res = {
    statusCode: 200, headers: {}, cookies: [], body: undefined, headersSent: false,
    set(a, b) { if (typeof a === 'object') Object.assign(res.headers, a); else res.headers[a] = b; return res; },
    status(c) { res.statusCode = c; return res; },
    json(b) { res.body = b; return res; },
    cookie(name, value, options) { res.cookies.push({ name, options }); return res; },
    clearCookie(name, options) { res.cookies.push({ name, options }); return res; },
  };
  return res;
};

test('production mode is detected', () => {
  assert.equal(config.isProduction, true);
});

test('session and CSRF cookies are Secure in production, and clearing them keeps the attribute', () => {
  const res = mockRes();
  session.setSessionCookie(res, session.createSessionToken());
  csrf.setCsrfCookie(res, csrf.createCsrfToken());
  session.clearSessionCookie(res);
  session.clearCsrfCookie(res);
  assert.equal(res.cookies.length, 4);
  for (const { name, options } of res.cookies) assert.equal(options.secure, true, `${name} must be Secure`);
  assert.equal(res.cookies[0].options.httpOnly, true);
});

test('HSTS is sent in production', () => {
  const res = mockRes();
  securityHeaders({}, res, () => {});
  assert.match(res.headers['Strict-Transport-Security'], /max-age=\d+/);
});

test('unexpected errors are masked in production but client errors keep their message', () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const hidden = mockRes();
    errorHandler(new Error('relation "users" does not exist at /srv/app/secret.js'), {}, hidden, () => {});
    assert.equal(hidden.statusCode, 500);
    assert.deepEqual(hidden.body, { error: { message: 'Internal server error' } });

    const visible = mockRes();
    errorHandler(Object.assign(new Error('Task not found'), { status: 404 }), {}, visible, () => {});
    assert.deepEqual(visible.body, { error: { message: 'Task not found' } });
  } finally {
    console.error = originalError;
  }
});

test('seeding a production database is refused unless explicitly overridden', async () => {
  await assert.rejects(seedDatabase(), /Refusing to seed a production database/);
});

test('the API refuses to start in production without an explicit CLIENT_ORIGIN and a database password', () => {
  assert.throws(() => createApp(), (error) => {
    assert.match(error.message, /unsafe production configuration/);
    assert.match(error.message, /CLIENT_ORIGIN must be set/);
    assert.match(error.message, /DEVFLOW_DB_PASSWORD/);
    return true;
  });
});

test('the unauthenticated health response does not reveal the environment or uptime in production', () => {
  const health = getHealthStatus();
  assert.equal(health.status, 'ok');
  assert.equal(Object.hasOwn(health, 'environment'), false);
  assert.equal(Object.hasOwn(health, 'uptimeSeconds'), false);
});
