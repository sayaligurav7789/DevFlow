// Authorization matrix: every endpoint family is called as every kind of caller, and the status is
// compared with the rule written in the controllers. Also covers cross-object (IDOR) access,
// mass assignment and SQL-injection probes over HTTP. Requires PostgreSQL (database name *_test).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  createProject, createTask, createTestUser, createWorkspace, ctx, pool, request, setupHarness,
} from '../test-support/stage7.js';

const rand = () => randomBytes(3).toString('hex');
let foreignOwner;
let foreign; // { workspaceId, project, task }
let task; // a task in ctx.project created by the owner (so the owner is creator and reporter)

setupHarness(async () => {
  foreignOwner = await createTestUser('foreignOwner');
  const workspaceId = await createWorkspace('foreign', [[foreignOwner, 'owner']]);
  const project = await createProject(workspaceId, foreignOwner, 'Foreign project');
  foreign = { workspaceId, project, task: await createTask(project.id, foreignOwner, { title: 'Foreign task' }) };
  task = await createTask(ctx.project.id, ctx.owner, { title: 'Matrix task' });
});

// Subjects, in the column order used by the expectations below.
const SUBJECTS = ['anonymous', 'outsider (no workspace)', 'owner of another workspace', 'member', 'admin', 'owner'];
const subjectUsers = () => [undefined, ctx.outsider, foreignOwner, ctx.member, ctx.admin, ctx.owner];

const W = () => `/api/workspaces/${ctx.workspaceId}`;
const P = () => `/api/projects/${ctx.project.id}`;

// Each row: [name, build() -> [method, path, body?], expected statuses per subject].
// `build` runs before every call so destructive rows get a fresh target each time.
const ROWS = [
  ['read workspace', () => ['GET', W()], [401, 404, 404, 200, 200, 200]],
  ['update workspace name', () => ['PATCH', W(), { name: `Renamed ${rand()}` }], [401, 404, 404, 403, 200, 200]],
  ['list members', () => ['GET', `${W()}/members`], [401, 404, 404, 200, 200, 200]],
  ['list invitations', () => ['GET', `${W()}/invitations`], [401, 404, 404, 403, 200, 200]],
  ['create member invitation', () => ['POST', `${W()}/invitations`, { email: `inv-${rand()}@example.test`, role: 'member' }], [401, 404, 404, 201, 201, 201]],
  ['dashboard', () => ['GET', `${W()}/dashboard`], [401, 404, 404, 200, 200, 200]],
  ['workspace activity', () => ['GET', `${W()}/activity`], [401, 404, 404, 200, 200, 200]],
  ['workspace task list', () => ['GET', `${W()}/tasks`], [401, 404, 404, 200, 200, 200]],
  ['list projects', () => ['GET', `${W()}/projects`], [401, 404, 404, 200, 200, 200]],
  ['create project', () => ['POST', `${W()}/projects`, { name: `Matrix ${rand()}` }], [401, 404, 404, 403, 201, 201]],
  ['read project', () => ['GET', `${W()}/projects/${ctx.project.id}`], [401, 404, 404, 200, 200, 200]],
  ['update project', () => ['PATCH', `${W()}/projects/${ctx.project.id}`, { description: `d ${rand()}` }], [401, 404, 404, 403, 200, 200]],
  ['archive project', async () => {
    const project = await createProject(ctx.workspaceId, ctx.owner);
    return ['POST', `${W()}/projects/${project.id}/archive`];
  }, [401, 404, 404, 403, 200, 200]],
  ['delete project', async () => {
    const project = await createProject(ctx.workspaceId, ctx.owner);
    return ['DELETE', `${W()}/projects/${project.id}`];
  }, [401, 404, 404, 403, 200, 200]],
  ['board', () => ['GET', `${P()}/board`], [401, 404, 404, 200, 200, 200]],
  ['project activity', () => ['GET', `${P()}/activity`], [401, 404, 404, 200, 200, 200]],
  ['list tasks', () => ['GET', `${P()}/tasks`], [401, 404, 404, 200, 200, 200]],
  ['create task', () => ['POST', `${P()}/tasks`, { title: `T ${rand()}` }], [401, 404, 404, 201, 201, 201]],
  ['read task', () => ['GET', `${P()}/tasks/${task.id}`], [401, 404, 404, 200, 200, 200]],
  ['update task', () => ['PATCH', `${P()}/tasks/${task.id}`, { description: `d ${rand()}` }], [401, 404, 404, 200, 200, 200]],
  ['move task', () => ['POST', `${P()}/tasks/${task.id}/move`, { status: 'in_review', afterTaskId: null }], [401, 404, 404, 200, 200, 200]],
  ['task activity', () => ['GET', `${P()}/tasks/${task.id}/activity`], [401, 404, 404, 200, 200, 200]],
  // A member who did not create or report the task may not delete it; admins and owners may.
  ['delete someone else\'s task', async () => {
    const t = await createTask(ctx.project.id, ctx.owner, { title: `Del ${rand()}` });
    return ['DELETE', `${P()}/tasks/${t.id}`];
  }, [401, 404, 404, 403, 200, 200]],
  ['change a member role', async () => {
    const wid = await createWorkspace(`roles-${rand()}`, [[ctx.owner, 'owner'], [ctx.admin, 'admin'], [ctx.member, 'member']]);
    return ['PATCH', `/api/workspaces/${wid}/members/${ctx.member.id}`, { role: 'admin' }];
  }, [401, 404, 404, 403, 403, 200]],
  ['delete a workspace', async () => {
    const wid = await createWorkspace(`del-${rand()}`, [[ctx.owner, 'owner'], [ctx.admin, 'admin'], [ctx.member, 'member']]);
    return ['DELETE', `/api/workspaces/${wid}`];
  }, [401, 404, 404, 403, 403, 200]],
  // Notifications belong to the caller, so every signed-in user may call them (and only sees their own).
  ['list own notifications', () => ['GET', '/api/notifications'], [401, 200, 200, 200, 200, 200]],
  ['unread count', () => ['GET', '/api/notifications/unread-count'], [401, 200, 200, 200, 200, 200]],
  ['mark all own notifications read', () => ['POST', '/api/notifications/read-all', {}], [401, 200, 200, 200, 200, 200]],
];

test('authorization matrix: every endpoint answers every kind of caller as the rules require', async () => {
  const users = subjectUsers();
  const failures = [];
  for (const [name, build, expected] of ROWS) {
    for (let i = 0; i < SUBJECTS.length; i += 1) {
      const [method, path, body] = await build();
      const { response } = await request(path, { user: users[i], method, body });
      if (response.status !== expected[i]) {
        failures.push(`${name} as ${SUBJECTS[i]}: expected ${expected[i]}, got ${response.status}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('non-members get 404, never 403, so workspace and project ids cannot be probed for existence', async () => {
  const real = await request(`${W()}`, { user: ctx.outsider });
  const fake = await request('/api/workspaces/999999999999', { user: ctx.outsider });
  assert.equal(real.response.status, 404);
  assert.deepEqual(real.data, { error: { message: 'Workspace not found' } });
  assert.deepEqual(fake.data, real.data, 'an existing workspace and a missing one look identical');

  const realProject = await request(`${P()}/board`, { user: ctx.outsider });
  const fakeProject = await request('/api/projects/999999999999/board', { user: ctx.outsider });
  assert.deepEqual(fakeProject.data, realProject.data);
});

test('object-level access: ids from another workspace never work through your own workspace or project', async () => {
  const stillThere = async (table, id) => (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1;
  const attempts = [
    ['GET', `${W()}/projects/${foreign.project.id}`],
    ['PATCH', `${W()}/projects/${foreign.project.id}`, { name: 'hijacked' }],
    ['POST', `${W()}/projects/${foreign.project.id}/archive`],
    ['DELETE', `${W()}/projects/${foreign.project.id}`],
    ['GET', `/api/projects/${foreign.project.id}/tasks`],
    ['GET', `/api/projects/${foreign.project.id}/board`],
    ['GET', `${P()}/tasks/${foreign.task.id}`],
    ['PATCH', `${P()}/tasks/${foreign.task.id}`, { title: 'hijacked' }],
    ['POST', `${P()}/tasks/${foreign.task.id}/move`, { status: 'done', afterTaskId: null }],
    ['DELETE', `${P()}/tasks/${foreign.task.id}`],
    ['GET', `${P()}/tasks/${foreign.task.id}/activity`],
    ['GET', `/api/workspaces/${foreign.workspaceId}/dashboard`],
    ['GET', `/api/workspaces/${foreign.workspaceId}/tasks`],
    ['PATCH', `/api/workspaces/${foreign.workspaceId}`, { name: 'hijacked' }],
    ['DELETE', `/api/workspaces/${foreign.workspaceId}`],
  ];
  for (const [method, path, body] of attempts) {
    const { response } = await request(path, { user: ctx.owner, method, body });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  assert.equal(await stillThere('projects', foreign.project.id), true);
  assert.equal(await stillThere('tasks', foreign.task.id), true);
  assert.equal(await stillThere('workspaces', foreign.workspaceId), true);
  const unchanged = await pool.query('SELECT name FROM projects WHERE id = $1', [foreign.project.id]);
  assert.equal(unchanged.rows[0].name, 'Foreign project');
});

test('a task cannot be assigned to, or reported by, someone outside its workspace', async () => {
  for (const field of ['assigneeId', 'reporterId']) {
    const create = await request(`${P()}/tasks`, { user: ctx.owner, method: 'POST', body: { title: 'x', [field]: foreignOwner.id } });
    assert.equal(create.response.status, 400, `create with foreign ${field}`);
    const update = await request(`${P()}/tasks/${task.id}`, { user: ctx.owner, method: 'PATCH', body: { [field]: foreignOwner.id } });
    assert.equal(update.response.status, 400, `update with foreign ${field}`);
  }
});

test('mass assignment: ownership and identity fields cannot be set through the API', async () => {
  const cases = [
    ['PATCH', `${W()}/projects/${ctx.project.id}`, { workspace_id: foreign.workspaceId }],
    ['PATCH', `${W()}/projects/${ctx.project.id}`, { workspaceId: foreign.workspaceId, createdBy: ctx.outsider.id }],
    ['POST', `${W()}/projects`, { name: 'x', workspaceId: foreign.workspaceId }],
    ['PATCH', `${P()}/tasks/${task.id}`, { projectId: foreign.project.id }],
    ['PATCH', `${P()}/tasks/${task.id}`, { createdBy: ctx.outsider.id }],
    ['PATCH', `${P()}/tasks/${task.id}`, { id: '1' }],
    ['POST', `${P()}/tasks`, { title: 'x', projectId: foreign.project.id }],
    ['POST', `${P()}/tasks/${task.id}/move`, { status: 'done', projectId: foreign.project.id }],
  ];
  for (const [method, path, body] of cases) {
    const { response } = await request(path, { user: ctx.owner, method, body });
    assert.equal(response.status, 400, `${method} ${path} ${JSON.stringify(body)}`);
  }
  const project = await pool.query('SELECT workspace_id::TEXT AS "workspaceId" FROM projects WHERE id = $1', [ctx.project.id]);
  assert.equal(project.rows[0].workspaceId, ctx.workspaceId);
  const owned = await pool.query('SELECT project_id::TEXT AS "projectId" FROM tasks WHERE id = $1', [task.id]);
  assert.equal(owned.rows[0].projectId, ctx.project.id);
});

test('SQL injection probes are inert: filters are parameters, sort keys are allowlisted, and nothing is damaged', async () => {
  const count = async (table) => (await pool.query(`SELECT COUNT(*)::INT AS n FROM ${table}`)).rows[0].n;
  const before = { users: await count('users'), tasks: await count('tasks'), projects: await count('projects'), sessions: await count('sessions') };

  const payloads = ["' OR '1'='1", "'; DROP TABLE tasks; --", '%', '_', "\\' OR 1=1 --", '1) OR (1=1', 'a'.repeat(120)];
  for (const payload of payloads) {
    const q = encodeURIComponent(payload);
    for (const path of [
      `${W()}/tasks?q=${q}`, `${P()}/tasks?q=${q}`, `${P()}/board?q=${q}`, `${W()}/projects?q=${q}`, `${P()}/tasks?label=${q}`,
    ]) {
      const { response } = await request(path, { user: ctx.owner });
      assert.ok([200, 400].includes(response.status), `${path} -> ${response.status}`);
    }
  }
  for (const [path, expected] of [
    [`${W()}/tasks?sortBy=${encodeURIComponent('title; DROP TABLE tasks')}`, 400],
    [`${W()}/tasks?sortOrder=${encodeURIComponent('asc; DROP TABLE tasks')}`, 400],
    [`${W()}/tasks?sortBy=constructor`, 400],
    [`${W()}/projects?sortBy=__proto__`, 400],
    [`${W()}/tasks?assigneeId=${encodeURIComponent('1 OR 1=1')}`, 400],
    [`${W()}/tasks?status=${encodeURIComponent("todo' OR '1'='1")}`, 400],
    [`${W()}/tasks?dueBefore=${encodeURIComponent("2026-01-01'; DROP TABLE tasks;--")}`, 400],
    [`${W()}/activity?actorId=${encodeURIComponent('1;DROP TABLE users')}`, 400],
    [`/api/workspaces/${encodeURIComponent('1; DROP TABLE users')}`, 404],
    [`/api/projects/${encodeURIComponent("1' OR '1'='1")}/board`, 404],
  ]) {
    const { response } = await request(path, { user: ctx.owner });
    assert.equal(response.status, expected, path);
  }

  const token = await request('/api/invitations/accept', { user: ctx.member, method: 'POST', body: { token: "' OR '1'='1" } });
  assert.ok([400, 404].includes(token.response.status), `invitation token probe -> ${token.response.status}`);

  assert.deepEqual(
    { users: await count('users'), tasks: await count('tasks'), projects: await count('projects'), sessions: await count('sessions') },
    before,
    'no probe may change any table',
  );
});
