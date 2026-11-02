// Shared harness for the Stage 7 integration tests (board, dashboard, activity).
// Call setupHarness() once at the top level of a test file; it registers before/after hooks.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { after, before } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');

const [{ createApp }, { pool }, { runMigrations }, { config }] = await Promise.all([
  import('../src/app.js'),
  import('../src/db/pool.js'),
  import('../src/db/migrate.js'),
  import('../src/config/env.js'),
]);

export { pool };

export const runId = randomBytes(6).toString('hex');
export const ctx = {}; // owner, admin, member, outsider, workspaceId, project

const users = [];
const workspaceIds = [];

let server;
let baseUrl;
let csrfCookie;
let csrfToken;

// Normalize generated workspace slugs to lowercase, URL-safe values.
function normalizeSlug(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'workspace';
}

function cookiePair(response, name) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);

  const value = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  assert.ok(value, `Expected ${name} cookie`);

  return value.split(';', 1)[0];
}

export async function request(
  path,
  { user, method = 'GET', body, sendCsrf = true } = {},
) {
  const headers = { Accept: 'application/json' };

  const cookieValues = [csrfCookie, user?.sessionCookie].filter(Boolean);

  if (cookieValues.length) {
    headers.Cookie = cookieValues.join('; ');
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (sendCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = response.status === 204 ? null : await response.json();

  return { response, data };
}

// Lets a test hand over a user it created through the API
// so the harness deletes it afterwards.
export function trackUser(id) {
  users.push({ id });
}

// Creates a test user with a normalized email address.
export async function createTestUser(label) {
  const normalizedLabel = String(label).trim().toLowerCase();

  const inserted = await pool.query(
    `INSERT INTO users (email, display_name) VALUES ($1, $2)
     RETURNING id::TEXT AS id, email, display_name AS "displayName"`,
    [
      `${normalizedLabel}-${randomBytes(3).toString('hex')}-${runId}@example.test`,
      `S7 ${label}`,
    ],
  );

  const user = inserted.rows[0];
  const token = randomBytes(32).toString('base64url');

  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')",
    [createHash('sha256').update(token).digest('hex'), user.id],
  );

  user.sessionCookie = `devflow_session=${token}`;
  users.push(user);
  return user;
}

// Creates a workspace directly in SQL with the given [user, role] memberships.
export async function createWorkspace(label, memberships) {
  const [[creator]] = memberships;

  const slug = `s7-${normalizeSlug(label)}-${runId}`;

  const result = await pool.query(
    'INSERT INTO workspaces (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id::TEXT AS id',
    [slug, `S7 ${label} ${runId}`, creator.id],
  );

  const id = result.rows[0].id;

  workspaceIds.push(id);

  for (const [user, role] of memberships) {
    await pool.query(
      'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [id, user.id, role],
    );
  }

  return id;
}

export async function createProject(
  workspaceId,
  user,
  name = `Project ${randomBytes(3).toString('hex')}`,
) {
  const result = await request(
    `/api/workspaces/${workspaceId}/projects`,
    {
      user,
      method: 'POST',
      body: { name },
    },
  );

  assert.equal(result.response.status, 201, result.data?.error?.message);

  return result.data.project;
}

export async function createTask(projectId, user, fields) {
  const result = await request(
    `/api/projects/${projectId}/tasks`,
    {
      user,
      method: 'POST',
      body: fields,
    },
  );

  assert.equal(result.response.status, 201, result.data?.error?.message);

  return result.data.task;
}

export async function moveTask(projectId, taskId, user, body) {
  return request(
    `/api/projects/${projectId}/tasks/${taskId}/move`,
    {
      user,
      method: 'POST',
      body,
    },
  );
}

export async function board(projectId, user, query = '') {
  const result = await request(
    `/api/projects/${projectId}/board${query}`,
    { user },
  );

  assert.equal(result.response.status, 200, result.data?.error?.message);

  return result.data;
}

export const column = (boardData, status) =>
  boardData.columns.find((c) => c.status === status);

export const titles = (boardData, status) =>
  column(boardData, status).tasks.map((t) => t.title);

// YYYY-MM-DD for today (UTC) plus an offset in days.
export function day(offset = 0) {
  const d = new Date();

  d.setUTCDate(d.getUTCDate() + offset);

  return d.toISOString().slice(0, 10);
}

// Counts every statement sent to PostgreSQL while `fn` runs
// (pool.query and checked-out clients).
export async function countQueries(fn) {
  let count = 0;

  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  pool.query = (...args) => {
    count += 1;
    return originalQuery(...args);
  };

  pool.connect = async (...args) => {
    // pool.query() calls connect(callback) internally;
    // that path is already counted at pool level.
    if (typeof args[0] === 'function') {
      return originalConnect(...args);
    }

    const client = await originalConnect(...args);
    const clientQuery = client.query.bind(client);

    client.query = (...a) => {
      count += 1;
      return clientQuery(...a);
    };

    return client;
  };

  try {
    await fn();
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }

  return count;
}

// `seed` runs after the shared users and workspace exist,
// so ordering never depends on hook registration.
export function setupHarness(seed) {
  before(async () => {
    if (!config.database.name.endsWith('_test')) {
      throw new Error(
        'Refusing to run Stage 7 tests unless DEVFLOW_DB_NAME ends with _test.',
      );
    }

    await runMigrations();

    server = createApp().listen(0, '127.0.0.1');

    await once(server, 'listening');

    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const csrf = await request('/api/auth/csrf');

    assert.equal(csrf.response.status, 204);

    csrfCookie = cookiePair(csrf.response, 'devflow_csrf');
    csrfToken = csrfCookie.slice('devflow_csrf='.length);

    [ctx.owner, ctx.admin, ctx.member, ctx.outsider] = await Promise.all([
      createTestUser('owner'),
      createTestUser('admin'),
      createTestUser('member'),
      createTestUser('outsider'),
    ]);

    ctx.workspaceId = await createWorkspace(
      'main',
      [
        [ctx.owner, 'owner'],
        [ctx.admin, 'admin'],
        [ctx.member, 'member'],
      ],
    );

    ctx.project = await createProject(
      ctx.workspaceId,
      ctx.owner,
      `Main ${runId}`,
    );

    if (seed) {
      await seed();
    }
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }

    for (const id of workspaceIds) {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
    }

    for (const user of users) {
      await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    }

    await pool.end();
  });
}