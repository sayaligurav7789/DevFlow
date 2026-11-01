import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test, { after, before } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = randomBytes(48).toString('base64url');

const [{ createApp }, { pool }, { runMigrations }, { config }] = await Promise.all([
  import('../src/app.js'),
  import('../src/db/pool.js'),
  import('../src/db/migrate.js'),
  import('../src/config/env.js'),
]);

const runId = randomBytes(6).toString('hex');
const users = [];
const workspaceIds = [];
let server;
let baseUrl;
let csrfCookie;
let csrfToken;
let owner;
let admin;
let member;
let outsider;
let workspaceId;
let project;

function cookiePair(response, name) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const value = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(value, `Expected ${name} cookie`);
  return value.split(';', 1)[0];
}

async function request(path, { user, method = 'GET', body, sendCsrf = true } = {}) {
  const headers = { Accept: 'application/json' };
  const cookieValues = [csrfCookie, user?.sessionCookie].filter(Boolean);
  if (cookieValues.length) headers.Cookie = cookieValues.join('; ');
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (sendCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

async function createTestUser(label) {
  const inserted = await pool.query(
    `INSERT INTO users (email, display_name)
     VALUES ($1, $2)
     RETURNING id::TEXT AS id, email, display_name AS "displayName"`,
    [`${label}-${runId}@example.test`, `Stage 6 ${label}`],
  );
  const user = inserted.rows[0];
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 day\')',
    [createHash('sha256').update(token).digest('hex'), user.id],
  );
  user.sessionCookie = `devflow_session=${token}`;
  users.push(user);
  return user;
}

async function createProject(user = owner, name = `Project ${randomBytes(3).toString('hex')}`) {
  const result = await request(`/api/workspaces/${workspaceId}/projects`, {
    user,
    method: 'POST',
    body: { name },
  });
  assert.equal(result.response.status, 201, result.data?.error?.message);
  return result.data.project;
}

function taskPath(projectId, suffix = '') {
  return `/api/projects/${projectId}/tasks${suffix}`;
}

before(async () => {
  if (!config.database.name.endsWith('_test')) {
    throw new Error('Refusing to run workspace task tests unless DEVFLOW_DB_NAME ends with _test.');
  }
  await runMigrations();
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const csrf = await request('/api/auth/csrf');
  assert.equal(csrf.response.status, 204);
  csrfCookie = cookiePair(csrf.response, 'devflow_csrf');
  csrfToken = csrfCookie.slice('devflow_csrf='.length);

  [owner, admin, member, outsider] = await Promise.all([
    createTestUser('owner'),
    createTestUser('admin'),
    createTestUser('member'),
    createTestUser('outsider'),
  ]);
  const workspace = await pool.query(
    `INSERT INTO workspaces (slug, name, created_by)
     VALUES ($1, $2, $3) RETURNING id::TEXT AS id`,
    [`stage6-${runId}`, `Stage 6 ${runId}`, owner.id],
  );
  workspaceId = workspace.rows[0].id;
  workspaceIds.push(workspaceId);
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member')`,
    [workspaceId, owner.id, admin.id, member.id],
  );
  project = await createProject(owner, `Stage 5 Main ${runId}`);
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  for (const id of workspaceIds) await pool.query('DELETE FROM workspaces WHERE id = $1', [id]);
  for (const user of users) await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  await pool.end();
});


async function makeTask(projectId, user, fields) {
  const result = await request(taskPath(projectId), { user, method: 'POST', body: fields });
  assert.equal(result.response.status, 201, result.data?.error?.message);
  return result.data.task;
}

test('workspace task list spans projects, filters, searches, sorts, and paginates', async () => {
  const second = await createProject(owner, `Stage 6 Second ${runId}`);
  await makeTask(project.id, owner, { title: 'Alpha login bug', priority: 'urgent', status: 'in_progress', assigneeId: member.id, labels: ['bug'] });
  await makeTask(project.id, owner, { title: 'Beta docs', priority: 'low', status: 'todo' });
  await makeTask(second.id, member, { title: 'Gamma login polish', priority: 'high', status: 'todo', assigneeId: member.id });

  const all = await request(`/api/workspaces/${workspaceId}/tasks`, { user: member });
  assert.equal(all.response.status, 200);
  assert.equal(all.data.pagination.total, 3);
  const row = all.data.tasks.find((task) => task.title === 'Gamma login polish');
  assert.equal(row.projectName, `Stage 6 Second ${runId}`);
  assert.equal(row.projectArchived, false);
  assert.ok(row.projectSlug);

  const mine = await request(`/api/workspaces/${workspaceId}/tasks?assigneeId=${member.id}&sortBy=title&sortOrder=asc`, { user: member });
  assert.deepEqual(mine.data.tasks.map((task) => task.title), ['Alpha login bug', 'Gamma login polish']);

  const search = await request(`/api/workspaces/${workspaceId}/tasks?q=login&status=todo`, { user: member });
  assert.deepEqual(search.data.tasks.map((task) => task.title), ['Gamma login polish']);

  const byProject = await request(`/api/workspaces/${workspaceId}/tasks?projectId=${second.id}`, { user: member });
  assert.equal(byProject.data.pagination.total, 1);

  const page = await request(`/api/workspaces/${workspaceId}/tasks?limit=2&page=2&sortBy=title&sortOrder=asc`, { user: member });
  assert.equal(page.data.tasks.length, 1);
  assert.equal(page.data.pagination.totalPages, 2);
});

test('workspace task list rejects invalid input and enforces workspace boundaries', async () => {
  for (const query of ['sortBy=password', 'sortOrder=sideways', 'status=nope', 'priority=huge', 'assigneeId=abc', 'projectId=1;DROP', 'limit=1000', 'page=0', 'bogus=1', 'dueAfter=2026-13-45']) {
    const result = await request(`/api/workspaces/${workspaceId}/tasks?${query}`, { user: member });
    assert.equal(result.response.status, 400, `${query} should be rejected`);
  }
  const outside = await request(`/api/workspaces/${workspaceId}/tasks`, { user: outsider });
  assert.equal(outside.response.status, 404);
  const anonymous = await request(`/api/workspaces/${workspaceId}/tasks`);
  assert.equal(anonymous.response.status, 401);

  // A project id from this workspace must not leak tasks when asked through another workspace.
  const other = await pool.query(
    `INSERT INTO workspaces (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id::TEXT AS id`,
    [`stage6-other-${runId}`, 'Other', outsider.id],
  );
  workspaceIds.push(other.rows[0].id);
  await pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [other.rows[0].id, outsider.id]);
  const leak = await request(`/api/workspaces/${other.rows[0].id}/tasks?projectId=${project.id}`, { user: outsider });
  assert.equal(leak.response.status, 200);
  assert.equal(leak.data.pagination.total, 0);
});
