// Authentication, session, cookie, header, CORS and rate-limit behaviour over real HTTP,
// against PostgreSQL. Requires a database whose name ends in _test.
// Redis is replaced by an in-memory double where a test needs it.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test, { after, before } from 'node:test';

import {
  createTestUser,
  pool,
  runId,
  setupHarness,
  trackUser,
} from '../test-support/stage7.js';

import { FakeRedis } from '../test-support/fakeRedis.js';

const [
  { createApp },
  { config },
  redisLib,
  { loginLimiter },
] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/env.js'),
  import('../src/lib/redis.js'),
  import('../src/middleware/rateLimit.js'),
]);

setupHarness();

const servers = [];
const bases = [];

let csrf;

async function startInstance() {
  const server = createApp().listen(0, '127.0.0.1');

  await once(server, 'listening');

  servers.push(server);

  const base = `http://127.0.0.1:${server.address().port}`;

  bases.push(base);

  return base;
}

before(async () => {
  const base = await startInstance();

  const response = await fetch(`${base}/api/auth/csrf`);

  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith('devflow_csrf='))
    .split(';')[0];

  csrf = {
    cookie,
    token: cookie.slice('devflow_csrf='.length),
  };
});

after(async () => {
  redisLib.setRedisClientForTests(null);

  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => server.close(resolve))
    )
  );
});

// Raw fetch with full control over headers and body.
// json is serialized; rawBody is sent as is.

async function raw(
  path,
  {
    base = bases[0],
    method = 'GET',
    headers = {},
    json,
    rawBody,
    sendCsrf = true,
    sessionCookie,
    extraCookies = [],
  } = {}
) {
  const requestHeaders = {
    Accept: 'application/json',
    ...headers,
  };

  const cookies = [
    sendCsrf && csrf.cookie,
    sessionCookie,
    ...extraCookies,
  ].filter(Boolean);

  if (cookies.length) {
    requestHeaders.Cookie = cookies.join('; ');
  }

  if (
    sendCsrf &&
    !['GET', 'HEAD', 'OPTIONS'].includes(method)
  ) {
    requestHeaders['X-CSRF-Token'] = csrf.token;
  }

  let body = rawBody;

  if (json !== undefined) {
    body = JSON.stringify(json);
    requestHeaders['Content-Type'] = 'application/json';
  } else if (rawBody !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${base}${path}`, {
    method,
    headers: requestHeaders,
    body,
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    response,
    data,
    text,
  };
}

const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

const setCookies = (response) =>
  response.headers.getSetCookie();

const uniqueEmail = (label) =>
  `${label}-${randomBytes(3).toString('hex')}-${runId}@example.test`;

// --------------------------------------------------
// Registration security
// --------------------------------------------------

test(
  'registration stores a bcrypt hash and only the SHA-256 of the session token; cookies are locked down',
  async () => {
    const email = uniqueEmail('authsec');

    const password = 'correct horse battery staple';

    const { response, data, text } = await raw(
      '/api/auth/register',
      {
        method: 'POST',
        json: {
          email,
          displayName: 'Auth Sec',
          password,
        },
      }
    );

    assert.equal(response.status, 201, text);

    assert.deepEqual(Object.keys(data), ['user']);

    // FIX 1: Use data.user instead of undefined body.user.
    assert.deepEqual(Object.keys(data.user).sort(), [
      'avatarUrl',
      'displayName',
      'email',
      'id',
    ]);

    assert.ok(
      !text.includes(password) && !/hash/i.test(text),
      'response must not leak the password or any hash'
    );

    trackUser(data.user.id);

    const sessionCookie = setCookies(response).find(
      (c) => c.startsWith('devflow_session=')
    );

    assert.ok(sessionCookie, 'a session cookie is issued');

    assert.match(sessionCookie, /;\s*HttpOnly/i);

    assert.match(sessionCookie, /;\s*SameSite=Lax/i);

    assert.match(sessionCookie, /;\s*Path=\/api(;|$)/);

    assert.match(sessionCookie, /;\s*Max-Age=604800(;|$)/);

    assert.ok(
      !/;\s*Secure/i.test(sessionCookie),
      'Secure is production-only (see production-config.test.js)'
    );

    const token = sessionCookie
      .split(';')[0]
      .slice('devflow_session='.length);

    const user = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [data.user.id]
    );

    assert.match(
      user.rows[0].password_hash,
      /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/,
      'bcrypt, cost 12'
    );

    assert.ok(
      !user.rows[0].password_hash.includes(password)
    );

    const sessions = await pool.query(
      'SELECT token_hash, expires_at FROM sessions WHERE user_id = $1',
      [data.user.id]
    );

    assert.equal(sessions.rowCount, 1);

    assert.equal(
      sessions.rows[0].token_hash,
      sha256(token)
    );

    assert.notEqual(
      sessions.rows[0].token_hash,
      token
    );

    const lifetimeDays =
      (new Date(sessions.rows[0].expires_at) - Date.now()) /
      86_400_000;

    assert.ok(
      lifetimeDays > 6.9 && lifetimeDays <= 7,
      `session lasts 7 days, got ${lifetimeDays}`
    );
  }
);

// --------------------------------------------------
// Session expiration and deleted users
// --------------------------------------------------

test(
  'an expired session is rejected immediately, and a session for a deleted user is rejected too',
  async () => {
    const user = await createTestUser('expiry');

    assert.equal(
      (
        await raw('/api/auth/me', {
          sessionCookie: user.sessionCookie,
        })
      ).response.status,
      200
    );

    // FIX 2: Keep created_at earlier than expires_at.
    // Both timestamps are in the past, so the session is expired.
    await pool.query(
      `UPDATE sessions
       SET created_at = NOW() - INTERVAL '2 seconds',
           expires_at = NOW() - INTERVAL '1 second'
       WHERE user_id = $1`,
      [user.id]
    );

    const expired = await raw('/api/auth/me', {
      sessionCookie: user.sessionCookie,
    });

    assert.equal(expired.response.status, 401);

    assert.deepEqual(expired.data, {
      error: {
        message: 'Authentication required',
      },
    });

    const second = await createTestUser('deleted');

    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [second.id]
    );

    assert.equal(
      (
        await raw('/api/auth/me', {
          sessionCookie: second.sessionCookie,
        })
      ).response.status,
      401
    );
  }
);

// --------------------------------------------------
// Malformed and forged session cookies
// --------------------------------------------------

test(
  'malformed or forged session cookies are rejected without reaching the database',
  async () => {
    for (const value of [
      '',
      'x',
      'A'.repeat(42),
      'A'.repeat(44),
      `${'A'.repeat(42)}'`,
      `${'A'.repeat(43)}`,
      '../../etc/passwd',
      "' OR '1'='1",
    ]) {
      const { response } = await raw('/api/auth/me', {
        sessionCookie: `devflow_session=${encodeURIComponent(value)}`,
      });

      assert.equal(response.status, 401, JSON.stringify(value));
    }
  }
);

// --------------------------------------------------
// Logout and session invalidation
// --------------------------------------------------

test(
  'logout deletes the server-side session: replaying the cookie fails, other sessions are unaffected',
  async () => {
    const user = await createTestUser('logout');

    const otherToken = randomBytes(32).toString('base64url');

    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [sha256(otherToken), user.id]
    );

    const out = await raw('/api/auth/logout', {
      method: 'POST',
      sessionCookie: user.sessionCookie,
    });

    assert.equal(out.response.status, 200);

    const cleared = setCookies(out.response).find(
      (c) => c.startsWith('devflow_session=')
    );

    assert.match(
      cleared,
      /devflow_session=;|Expires=Thu, 01 Jan 1970/i
    );

    assert.equal(
      (
        await raw('/api/auth/me', {
          sessionCookie: user.sessionCookie,
        })
      ).response.status,
      401,
      'replay after logout'
    );

    assert.equal(
      (
        await raw('/api/auth/me', {
          sessionCookie: `devflow_session=${otherToken}`,
        })
      ).response.status,
      200,
      'a different session of the same user stays valid'
    );
  }
);

// --------------------------------------------------
// Session fixation
// --------------------------------------------------

test(
  'logging in issues a new session token every time (no session fixation)',
  async () => {
    const email = uniqueEmail('fixation');

    const password = 'another long passphrase here';

    const registered = await raw('/api/auth/register', {
      method: 'POST',
      json: {
        email,
        displayName: 'Fix',
        password,
      },
    });

    assert.equal(
      registered.response.status,
      201,
      registered.text
    );

    trackUser(registered.data.user.id);

    const first = setCookies(registered.response)
      .find((c) => c.startsWith('devflow_session='))
      .split(';')[0];

    const login = await raw('/api/auth/login', {
      method: 'POST',
      json: {
        email,
        password,
      },
      sessionCookie: first,
    });

    assert.equal(login.response.status, 200, login.text);

    const second = setCookies(login.response)
      .find((c) => c.startsWith('devflow_session='))
      .split(';')[0];

    assert.notEqual(second, first);
  }
);

// --------------------------------------------------
// Hostile login inputs
// --------------------------------------------------

test(
  'hostile or oddly-typed login input is a clean 400/401, never a 500',
  async () => {
    loginLimiter.resetMemoryForTests();

    const cases = [
      { email: { $ne: null }, password: 'x' },
      { email: ['a@b.co'], password: 'x' },
      { email: 'a@b.co', password: ['x'] },
      { email: 'a@b.co', password: { $gt: '' } },
      {
        email: "x'--@example.test",
        password: 'wrong password here',
      },
      {
        email: 'a@b.co',
        password: 'x'.repeat(5000),
      },
      null,
      [],
      'string body',
    ];

    for (const json of cases) {
      const { response } = await raw('/api/auth/login', {
        method: 'POST',
        json,
      });

      assert.ok(
        [400, 401].includes(response.status),
        `${JSON.stringify(json)?.slice(0, 40)} -> ${response.status}`
      );
    }

    loginLimiter.resetMemoryForTests();

    const unknown = await raw('/api/auth/login', {
      method: 'POST',
      json: {
        email: uniqueEmail('nobody'),
        password: 'wrong password here',
      },
    });

    assert.equal(unknown.response.status, 401);

    assert.deepEqual(unknown.data, {
      error: {
        message: 'Invalid email or password',
      },
    });
  }
);

// --------------------------------------------------
// Defensive response headers
// --------------------------------------------------

test(
  'every kind of API response carries the defensive headers and hides the framework',
  async () => {
    const probes = [
      ['/api/health', {}],
      ['/api/auth/me', {}],
      ['/api/nope', {}],
      [
        '/api/auth/login',
        {
          method: 'POST',
          json: { email: 'bad' },
        },
      ],
      [
        '/api/auth/logout',
        {
          method: 'POST',
          sendCsrf: false,
        },
      ],
    ];

    for (const [path, options] of probes) {
      const { response } = await raw(path, options);

      const where = `${options.method ?? 'GET'} ${path} (${response.status})`;

      assert.equal(
        response.headers.get('x-content-type-options'),
        'nosniff',
        where
      );

      assert.equal(
        response.headers.get('x-frame-options'),
        'DENY',
        where
      );

      assert.equal(
        response.headers.get('cache-control'),
        'no-store',
        where
      );

      assert.equal(
        response.headers.get('referrer-policy'),
        'no-referrer',
        where
      );

      assert.match(
        response.headers.get('content-security-policy') ?? '',
        /default-src 'none'/,
        where
      );

      assert.equal(
        response.headers.get('x-powered-by'),
        null,
        where
      );
    }
  }
);

// --------------------------------------------------
// CORS
// --------------------------------------------------

test(
  'CORS only ever names the configured origin, never a wildcard or the caller',
  async () => {
    const evil = 'https://evil.example';

    const allowed = await raw('/api/health', {
      headers: {
        Origin: config.clientOrigin,
      },
    });

    assert.equal(
      allowed.response.headers.get('access-control-allow-origin'),
      config.clientOrigin
    );

    assert.equal(
      allowed.response.headers.get('access-control-allow-credentials'),
      'true'
    );

    const foreign = await raw('/api/health', {
      headers: {
        Origin: evil,
      },
    });

    const acao = foreign.response.headers.get(
      'access-control-allow-origin'
    );

    assert.notEqual(acao, '*');

    assert.notEqual(
      acao,
      evil,
      'a foreign origin must not be reflected, so browsers refuse to expose the response'
    );

    const preflight = await raw('/api/workspaces', {
      method: 'OPTIONS',
      sendCsrf: false,
      headers: {
        Origin: evil,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-csrf-token,content-type',
      },
    });

    assert.notEqual(
      preflight.response.headers.get('access-control-allow-origin'),
      evil
    );

    assert.notEqual(
      preflight.response.headers.get('access-control-allow-origin'),
      '*'
    );
  }
);

// --------------------------------------------------
// Malformed and oversized request bodies
// --------------------------------------------------

test(
  'malformed and oversized request bodies get fixed, non-echoing error messages',
  async () => {
    const marker = 'SECRET-MARKER-12345';

    const malformed = await raw('/api/auth/login', {
      method: 'POST',
      rawBody: `{"email": "${marker}", `,
    });

    assert.equal(malformed.response.status, 400);

    assert.ok(
      !malformed.text.includes(marker),
      'must not echo the request'
    );

    assert.deepEqual(malformed.data, {
      error: {
        message: 'Request body is not valid JSON',
      },
    });

    // FIX 3: 200 KB exceeds Express's usual 100 KB JSON parser limit.
    const huge = await raw('/api/auth/login', {
      method: 'POST',
      json: {
        email: 'a@b.co',
        password: 'x'.repeat(200_000),
      },
    });

    assert.equal(huge.response.status, 413);

    assert.deepEqual(huge.data, {
      error: {
        message: 'Request body is too large',
      },
    });
  }
);

// --------------------------------------------------
// CSRF protection
// --------------------------------------------------

test(
  'state-changing requests need a signed CSRF token that matches the cookie',
  async () => {
    const user = await createTestUser('csrf');

    const forged = `${'A'.repeat(43)}.${'B'.repeat(43)}`;

    const logout = (options) =>
      raw('/api/auth/logout', {
        method: 'POST',
        sessionCookie: user.sessionCookie,
        ...options,
      });

    assert.equal(
      (await logout({ sendCsrf: false })).response.status,
      403,
      'no token at all'
    );

    assert.equal(
      (
        await logout({
          sendCsrf: false,
          headers: {
            'X-CSRF-Token': csrf.token,
          },
        })
      ).response.status,
      403,
      'header without the cookie'
    );

    assert.equal(
      (
        await logout({
          sendCsrf: false,
          extraCookies: [`devflow_csrf=${forged}`],
          headers: {
            'X-CSRF-Token': forged,
          },
        })
      ).response.status,
      403,
      'cookie and header match but were never signed by the server'
    );

    assert.equal(
      (
        await logout({
          sendCsrf: false,
          extraCookies: [csrf.cookie],
          headers: {
            'X-CSRF-Token': forged,
          },
        })
      ).response.status,
      403,
      'valid cookie, different header'
    );

    assert.equal(
      (
        await raw('/api/auth/me', {
          sessionCookie: user.sessionCookie,
        })
      ).response.status,
      200,
      'the session survived the rejected attempts'
    );
  }
);

// ---- Rate limiting over HTTP (each spends a budget, so these come last) ----

// --------------------------------------------------
// Registration rate limiting
// --------------------------------------------------

test(
  'registration is limited per IP: the budget runs out with 429 and Retry-After',
  async () => {
    const statuses = [];

    let last;

    for (
      let i = 0;
      i < 10 && !statuses.includes(429);
      i += 1
    ) {
      last = await raw('/api/auth/register', {
        method: 'POST',
        json: {
          email: 'not-an-email',
        },
      });

      statuses.push(last.response.status);
    }

    assert.ok(
      statuses.includes(429),
      `expected a 429, got ${statuses}`
    );

    assert.deepEqual(
      new Set(statuses.slice(0, -1)),
      new Set([400]),
      'requests inside the budget are processed normally'
    );

    assert.ok(
      Number(last.response.headers.get('retry-after')) >= 1
    );

    assert.deepEqual(last.data, {
      error: {
        message: 'Too many registration attempts. Try again later.',
      },
    });

    assert.match(
      last.response.headers.get('ratelimit-policy'),
      /^5;w=3600$/
    );
  }
);

// --------------------------------------------------
// Redis shared rate limiting
// --------------------------------------------------

test(
  'login is limited with a budget shared through Redis by every backend instance',
  async () => {
    const fake = new FakeRedis();

    redisLib.setRedisClientForTests(fake);

    redisLib.resetRedisBreakerForTests();

    loginLimiter.resetMemoryForTests();

    const other = await startInstance();

    const attempt = (base) =>
      raw('/api/auth/login', {
        base,
        method: 'POST',
        json: {
          email: uniqueEmail('stuffing'),
          password: 'wrong password here',
        },
      });

    const statuses = [];

    for (let i = 0; i < 8; i += 1) {
      statuses.push(
        (
          await attempt(i % 2 ? other : bases[0])
        ).response.status
      );
    }

    assert.deepEqual(
      statuses,
      Array(8).fill(401),
      'eight failures spread over two instances are all processed'
    );

    const blockedA = await attempt(bases[0]);

    const blockedB = await attempt(other);

    assert.equal(blockedA.response.status, 429);

    assert.equal(
      blockedB.response.status,
      429,
      'the second instance sees the same exhausted budget'
    );

    assert.ok(
      Number(blockedA.response.headers.get('retry-after')) >= 1
    );

    assert.equal(
      blockedA.response.headers.get('x-ratelimit-mode'),
      null,
      'Redis, not the fallback, held the counter'
    );

    assert.ok(
      fake.keys().some((key) =>
        key.includes(':ratelimit:login:')
      )
    );
  }
);

// --------------------------------------------------
// Redis outage fallback
// --------------------------------------------------

test(
  'login limiting survives a Redis outage by degrading to a per-process budget',
  async () => {
    const fake = new FakeRedis();

    redisLib.setRedisClientForTests(fake);

    redisLib.resetRedisBreakerForTests();

    loginLimiter.resetMemoryForTests();

    fake.failing = true;

    const statuses = [];

    for (let i = 0; i < 9; i += 1) {
      const { response } = await raw('/api/auth/login', {
        method: 'POST',
        json: {
          email: uniqueEmail('outage'),
          password: 'wrong password here',
        },
      });

      statuses.push(response.status);

      assert.equal(
        response.headers.get('x-ratelimit-mode'),
        'degraded'
      );
    }

    assert.deepEqual(
      statuses,
      [...Array(8).fill(401), 429]
    );

    redisLib.setRedisClientForTests(null);
  }
);