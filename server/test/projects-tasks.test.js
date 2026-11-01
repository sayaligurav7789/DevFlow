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
    [`${label}-${runId}@example.test`, `Stage 5 ${label}`],
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
    throw new Error('Refusing to run project/task tests unless DEVFLOW_DB_NAME ends with _test.');
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
    [`stage5-${runId}`, `Stage 5 ${runId}`, owner.id],
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

test('projects support workspace-scoped CRUD, archive/restore, filters, sorting, and pagination', async () => {
  const projectA = project;
  const projectB = await createProject(admin, `Alpha Project ${runId}`);
  const projectC = await createProject(owner, `Zeta Project ${runId}`);

  const read = await request(`/api/workspaces/${workspaceId}/projects/${projectA.id}`, { user: member });
  assert.equal(read.response.status, 200);
  assert.equal(read.data.project.id, projectA.id);

  const update = await request(`/api/workspaces/${workspaceId}/projects/${projectB.id}`, {
    user: admin,
    method: 'PATCH',
    body: { description: 'Updated project description' },
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.data.project.description, 'Updated project description');

  const sorted = await request(`/api/workspaces/${workspaceId}/projects?sortBy=name&sortOrder=asc&limit=1&page=1`, {
    user: member,
  });
  assert.equal(sorted.response.status, 200);
  assert.equal(sorted.data.pagination.total, 3);
  assert.equal(sorted.data.projects.length, 1);
  assert.equal(sorted.data.projects[0].id, projectB.id);

  const filtered = await request(`/api/workspaces/${workspaceId}/projects?q=${encodeURIComponent('Alpha')}`, { user: owner });
  assert.deepEqual(filtered.data.projects.map((item) => item.id), [projectB.id]);

  const archiveDenied = await request(`/api/workspaces/${workspaceId}/projects/${projectC.id}/archive`, {
    user: member,
    method: 'POST',
  });
  assert.equal(archiveDenied.response.status, 403);
  const archived = await request(`/api/workspaces/${workspaceId}/projects/${projectC.id}/archive`, {
    user: owner,
    method: 'POST',
  });
  assert.equal(archived.response.status, 200);
  assert.equal(archived.data.project.archived, true);
  const defaultList = await request(`/api/workspaces/${workspaceId}/projects`, { user: owner });
  assert.equal(defaultList.data.projects.some((item) => item.id === projectC.id), false);
  const archivedList = await request(`/api/workspaces/${workspaceId}/projects?archived=true`, { user: owner });
  assert.equal(archivedList.data.projects.some((item) => item.id === projectC.id), true);
  const restored = await request(`/api/workspaces/${workspaceId}/projects/${projectC.id}/restore`, {
    user: admin,
    method: 'POST',
  });
  assert.equal(restored.data.project.archived, false);

  const invalidSort = await request(`/api/workspaces/${workspaceId}/projects?sortBy=name%3Bdrop%20table%20projects`, {
    user: owner,
  });
  assert.equal(invalidSort.response.status, 400);
  const memberCreate = await request(`/api/workspaces/${workspaceId}/projects`, {
    user: member,
    method: 'POST',
    body: { name: 'Not allowed' },
  });
  assert.equal(memberCreate.response.status, 403);
  const outsiderRead = await request(`/api/workspaces/${workspaceId}/projects/${projectA.id}`, { user: outsider });
  assert.equal(outsiderRead.response.status, 404);
  const deleteDenied = await request(`/api/workspaces/${workspaceId}/projects/${projectA.id}`, {
    user: member,
    method: 'DELETE',
  });
  assert.equal(deleteDenied.response.status, 403);
  const deleteResult = await request(`/api/workspaces/${workspaceId}/projects/${projectC.id}`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(deleteResult.response.status, 200);
});

test('tasks support CRUD, assignment, validation, workspace boundaries, and activity history', async () => {
  const created = await request(taskPath(project.id), {
    user: member,
    method: 'POST',
    body: {
      title: `First task ${runId}`,
      description: 'Task description',
      status: 'backlog',
      priority: 'low',
      assigneeId: admin.id,
      dueAt: '2026-12-31',
      labels: ['backend', 'release'],
    },
  });
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const task = created.data.task;
  assert.equal(task.reporterId, member.id);
  assert.equal(task.assigneeId, admin.id);
  assert.deepEqual(task.labels, ['backend', 'release']);
  assert.equal(task.dueAt.toString().startsWith('2026-12-31'), true);

  const updated = await request(taskPath(project.id, `/${task.id}`), {
    user: member,
    method: 'PATCH',
    body: {
      status: 'in_progress',
      priority: 'high',
      assigneeId: owner.id,
      labels: ['backend'],
    },
  });
  assert.equal(updated.response.status, 200, updated.data?.error?.message);
  assert.equal(updated.data.task.status, 'in_progress');
  assert.equal(updated.data.task.priority, 'high');
  assert.equal(updated.data.task.assigneeId, owner.id);

  const fetched = await request(taskPath(project.id, `/${task.id}`), { user: admin });
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.data.task.title, task.title);

  const outsiderRead = await request(taskPath(project.id, `/${task.id}`), { user: outsider });
  assert.equal(outsiderRead.response.status, 404);
  const badReporter = await request(taskPath(project.id), {
    user: member,
    method: 'POST',
    body: { title: 'Bad reporter', reporterId: owner.id },
  });
  assert.equal(badReporter.response.status, 403);

  const history = await request(taskPath(project.id, `/${task.id}/activity`), { user: member });
  assert.equal(history.response.status, 200);
  assert.equal(history.data.pagination.total, 5);
  assert.equal(history.data.activity.some((item) => item.action === 'task.created'), true);
  assert.equal(history.data.activity.some((item) => item.action === 'task.status_changed'), true);
  assert.equal(history.data.activity.some((item) => item.action === 'task.reassigned'), true);

  const otherCreatorTask = await request(taskPath(project.id), {
    user: admin,
    method: 'POST',
    body: { title: 'Admin owned task' },
  });
  assert.equal(otherCreatorTask.response.status, 201);
  const deleteDenied = await request(taskPath(project.id, `/${otherCreatorTask.data.task.id}`), {
    user: member,
    method: 'DELETE',
  });
  assert.equal(deleteDenied.response.status, 403);
  const deleted = await request(taskPath(project.id, `/${task.id}`), { user: member, method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  const missing = await request(taskPath(project.id, `/${task.id}`), { user: owner });
  assert.equal(missing.response.status, 404);
});

test('task lists filter, search, sort, and paginate; invalid input returns 400', async () => {
  const taskA = await request(taskPath(project.id), {
    user: member,
    method: 'POST',
    body: { title: `Search target A ${runId}`, status: 'done', priority: 'urgent', labels: ['release'] },
  });
  const taskB = await request(taskPath(project.id), {
    user: member,
    method: 'POST',
    body: { title: `Search target B ${runId}`, status: 'done', priority: 'urgent', labels: ['release'] },
  });
  const unrelated = await request(taskPath(project.id), {
    user: owner,
    method: 'POST',
    body: { title: `Unrelated ${runId}`, status: 'todo', priority: 'low' },
  });
  assert.equal(taskA.response.status, 201);
  assert.equal(taskB.response.status, 201);
  assert.equal(unrelated.response.status, 201);

  const filtered = await request(
    taskPath(project.id, '?status=done&priority=urgent&label=release&sortBy=title&sortOrder=asc&page=1&limit=1'),
    { user: member },
  );
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.data.pagination.total, 2);
  assert.equal(filtered.data.pagination.totalPages, 2);
  assert.equal(filtered.data.tasks.length, 1);
  assert.equal(filtered.data.tasks[0].id, taskA.data.task.id);

  const searched = await request(taskPath(project.id, `?q=${encodeURIComponent(`Search target B ${runId}`)}`), {
    user: member,
  });
  assert.deepEqual(searched.data.tasks.map((item) => item.id), [taskB.data.task.id]);

  for (const [query, message] of [
    ['?status=blocked', 'status'],
    ['?sortBy=title%3Bdelete', 'sortBy'],
    ['?page=0', 'page'],
    ['?limit=101', 'limit'],
    ['?priority=urgent&unknown=1', 'unknown'],
  ]) {
    const invalid = await request(taskPath(project.id, query), { user: owner });
    assert.equal(invalid.response.status, 400, `${message}: ${invalid.data?.error?.message}`);
  }

  for (const body of [
    { title: 'Invalid status', status: 'blocked' },
    { title: 'Invalid priority', priority: 'immediate' },
    { title: 'Invalid due date', dueAt: '2026-02-30' },
    { title: 'Invalid labels', labels: [''] },
    { title: 'Invalid assignee', assigneeId: outsider.id },
    { title: '' },
    { title: 'Unknown field', sort: 'injected' },
  ]) {
    const invalid = await request(taskPath(project.id), { user: member, method: 'POST', body });
    assert.equal(invalid.response.status, 400, invalid.data?.error?.message);
  }
  const badId = await request(taskPath(project.id, '/not-a-number'), { user: owner });
  assert.equal(badId.response.status, 404);
});

test('archived projects are read-only for tasks and project deletion is workspace-scoped', async () => {
  const archivedProject = await createProject(owner, `Archived ${runId}`);
  const archive = await request(`/api/workspaces/${workspaceId}/projects/${archivedProject.id}/archive`, {
    user: owner,
    method: 'POST',
  });
  assert.equal(archive.response.status, 200);
  const create = await request(taskPath(archivedProject.id), {
    user: member,
    method: 'POST',
    body: { title: 'Cannot create in archived project' },
  });
  assert.equal(create.response.status, 409);

  const outsiderWorkspace = await pool.query(
    `INSERT INTO workspaces (slug, name, created_by)
     VALUES ($1, $2, $3) RETURNING id::TEXT AS id`,
    [`stage5-outsider-${runId}`, `Outside ${runId}`, outsider.id],
  );
  workspaceIds.push(outsiderWorkspace.rows[0].id);
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [outsiderWorkspace.rows[0].id, outsider.id],
  );
  const crossedProject = await pool.query(
    `INSERT INTO projects (workspace_id, slug, name, created_by)
     VALUES ($1, 'outside-project', 'Outside project', $2)
     RETURNING id::TEXT AS id`,
    [outsiderWorkspace.rows[0].id, outsider.id],
  );
  const crossWorkspace = await request(`/api/workspaces/${workspaceId}/projects/${crossedProject.rows[0].id}`, {
    user: owner,
  });
  assert.equal(crossWorkspace.response.status, 404);
  const outsiderTaskAccess = await request(taskPath(project.id), { user: outsider });
  assert.equal(outsiderTaskAccess.response.status, 404);

  const assigned = await request(taskPath(project.id), {
    user: owner,
    method: 'POST',
    body: { title: 'Unassign after member removal', assigneeId: member.id },
  });
  assert.equal(assigned.response.status, 201, assigned.data?.error?.message);
  const removeMember = await request(`/api/workspaces/${workspaceId}/members/${member.id}`, {
    user: owner,
    method: 'DELETE',
  });
  assert.equal(removeMember.response.status, 200);
  const taskAfterRemoval = await request(taskPath(project.id, `/${assigned.data.task.id}`), { user: owner });
  assert.equal(taskAfterRemoval.data.task.assigneeId, null);
  const taskHistory = await request(taskPath(project.id, `/${assigned.data.task.id}/activity`), { user: owner });
  assert.equal(taskHistory.data.activity.some(
    (event) => event.action === 'task.unassigned' && event.details.reason === 'member_removed',
  ), true);
});
