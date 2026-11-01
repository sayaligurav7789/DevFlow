import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test, { after, before } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');

const [{ createApp }, { pool }, { runMigrations }, bcrypt, { config }] = await Promise.all([
  import('../src/app.js'),
  import('../src/db/pool.js'),
  import('../src/db/migrate.js'),
  import('bcrypt'),
  import('../src/config/env.js'),
]);

const runId = randomBytes(6).toString('hex');
const originalEmail = `stage3-${runId}@example.test`;
const updatedEmail = `stage3-updated-${runId}@example.test`;
const password = randomBytes(24).toString('base64url');
let server;
let baseUrl;
let csrfToken;
let csrfCookie;
let sessionCookie;
let loginSessionCookie;
let registeredUser;

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const value = response.headers.get('set-cookie');
  return value ? [value] : [];
}

function cookiePair(response, name) {
  const cookie = responseCookies(response).find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `Expected ${name} cookie`);
  return cookie.split(';', 1)[0];
}

async function startServer() {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = null;
  await new Promise((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(path, {
  method = 'GET',
  body,
  cookies = [],
  sendCsrf = true,
  token = csrfToken,
} = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookies.length > 0) headers.Cookie = cookies.join('; ');
  if (sendCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) && token) {
    headers['X-CSRF-Token'] = token;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

before(async () => {
  if (!config.database.name.endsWith('_test')) {
    throw new Error('Refusing to run auth tests unless DEVFLOW_DB_NAME ends with _test.');
  }

  await runMigrations();
  await startServer();

  const csrf = await request('/api/auth/csrf');
  assert.equal(csrf.response.status, 204);
  assert.equal(csrf.data, null);
  csrfCookie = cookiePair(csrf.response, 'devflow_csrf');
  csrfToken = csrfCookie.slice('devflow_csrf='.length);
});

after(async () => {
  await stopServer();
  if (registeredUser?.id) {
    await pool.query('DELETE FROM users WHERE id = $1', [registeredUser.id]);
  }
  await pool.end();
});

test('Express starts and the health route confirms the PostgreSQL connection', async () => {
  const result = await request('/api/health');
  assert.equal(result.response.status, 200);
});

test('CSRF protection and server-side registration validation reject invalid requests', async () => {
  const csrfRejected = await request('/api/auth/register', {
    method: 'POST',
    body: { email: originalEmail, displayName: 'Test User', password },
    cookies: [],
    sendCsrf: false,
  });
  assert.equal(csrfRejected.response.status, 403);

  const invalidEmail = await request('/api/auth/register', {
    method: 'POST',
    body: { email: 'not-an-email', displayName: 'Test User', password },
    cookies: [csrfCookie],
  });
  assert.equal(invalidEmail.response.status, 400);
});

test('registration normalizes email, hashes the password, and never returns secrets', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email: `  ${originalEmail.toUpperCase()}  `,
      displayName: '  Stage Three Tester  ',
      password,
    },
    cookies: [csrfCookie],
  });

  assert.equal(result.response.status, 201);
  assert.equal(result.data.user.email, originalEmail);
  assert.equal(result.data.user.displayName, 'Stage Three Tester');
  assert.equal(Object.hasOwn(result.data.user, 'password_hash'), false);
  assert.equal(Object.hasOwn(result.data, 'token'), false);

  registeredUser = result.data.user;
  sessionCookie = cookiePair(result.response, 'devflow_session');
  const sessionToken = sessionCookie.slice('devflow_session='.length);
  const rows = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [registeredUser.id],
  );
  const passwordHash = rows.rows[0].password_hash;
  assert.match(passwordHash, /^\$2[aby]\$12\$/);
  assert.notEqual(passwordHash, password);
  assert.equal(await bcrypt.compare(password, passwordHash), true);
  assert.equal(await bcrypt.compare('wrong-password', passwordHash), false);

  const sessionRows = await pool.query(
    'SELECT token_hash, expires_at FROM sessions WHERE user_id = $1',
    [registeredUser.id],
  );
  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
  assert.equal(sessionRows.rowCount, 1);
  assert.equal(sessionRows.rows[0].token_hash, tokenHash);
  assert.notEqual(sessionRows.rows[0].token_hash, sessionToken);
  assert.ok(new Date(sessionRows.rows[0].expires_at) > new Date());

  const setCookie = responseCookies(result.response).find((value) => value.startsWith('devflow_session='));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/api/i);
  assert.equal(JSON.stringify(result.data).includes(sessionToken), false);
});

test('duplicate normalized email is rejected without creating a second user', async () => {
  const result = await request('/api/auth/register', {
    method: 'POST',
    body: { email: originalEmail.toUpperCase(), displayName: 'Duplicate', password },
    cookies: [csrfCookie],
  });

  assert.equal(result.response.status, 409);
  assert.equal(Object.hasOwn(result.data, 'password_hash'), false);
  const count = await pool.query('SELECT COUNT(*)::INTEGER AS count FROM users WHERE email = $1', [originalEmail]);
  assert.equal(count.rows[0].count, 1);
});

test('login rejects invalid credentials with a generic response', async () => {
  const wrongPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: originalEmail, password: randomBytes(24).toString('base64url') },
    cookies: [csrfCookie],
  });
  const unknownEmail = await request('/api/auth/login', {
    method: 'POST',
    body: { email: `missing-${runId}@example.test`, password },
    cookies: [csrfCookie],
  });

  assert.equal(wrongPassword.response.status, 401);
  assert.equal(unknownEmail.response.status, 401);
  assert.equal(wrongPassword.data.error.message, 'Invalid email or password');
  assert.equal(unknownEmail.data.error.message, wrongPassword.data.error.message);
});

test('login issues a persistent HttpOnly session cookie without returning its token', async () => {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { email: originalEmail, password },
    cookies: [csrfCookie],
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.id, registeredUser.id);
  assert.equal(Object.hasOwn(result.data, 'password_hash'), false);
  assert.equal(Object.hasOwn(result.data, 'token'), false);
  loginSessionCookie = cookiePair(result.response, 'devflow_session');
  const token = loginSessionCookie.slice('devflow_session='.length);
  assert.equal(JSON.stringify(result.data).includes(token), false);
});

test('protected profile routes reject requests without a valid session', async () => {
  const getProfile = await request('/api/auth/me');
  const updateProfile = await request('/api/auth/me', {
    method: 'PATCH',
    body: { displayName: 'Not Authorized' },
    cookies: [csrfCookie],
  });

  assert.equal(getProfile.response.status, 401);
  assert.equal(updateProfile.response.status, 401);
});

test('a database-backed session survives an Express server restart', async () => {
  await stopServer();
  await startServer();

  const result = await request('/api/auth/me', {
    cookies: [csrfCookie, loginSessionCookie],
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.id, registeredUser.id);
  assert.equal(result.data.user.email, originalEmail);
});

test('profile updates normalize email and return only public user fields', async () => {
  const result = await request('/api/auth/me', {
    method: 'PATCH',
    body: { email: ` ${updatedEmail.toUpperCase()} `, displayName: 'Updated Tester' },
    cookies: [csrfCookie, loginSessionCookie],
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.data.user.email, updatedEmail);
  assert.equal(result.data.user.displayName, 'Updated Tester');
  assert.equal(Object.hasOwn(result.data.user, 'password_hash'), false);
  assert.equal(Object.hasOwn(result.data, 'token'), false);
});

test('logout deletes its session and the old cookie can no longer access protected routes', async () => {
  const token = loginSessionCookie.slice('devflow_session='.length);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await request('/api/auth/logout', {
    method: 'POST',
    cookies: [csrfCookie, loginSessionCookie],
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { ok: true });
  const sessions = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [tokenHash]);
  assert.equal(sessions.rowCount, 0);

  const protectedResult = await request('/api/auth/me', {
    cookies: [csrfCookie, loginSessionCookie],
  });
  assert.equal(protectedResult.response.status, 401);
});
