// Input handling that must reject hostile input BEFORE any SQL is built. No database needed: the
// controllers throw 400 while parsing, so the (unused) pool is never queried.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

const [projects, tasks] = await Promise.all([
  import('../src/controllers/projects.controller.js'),
  import('../src/controllers/tasks.controller.js'),
]);

async function run(handler, req) {
  let error;
  let sent = false;
  const res = { json() { sent = true; return this; }, status() { return this; } };
  await handler(req, res, (e) => { error = e; });
  return { error, sent };
}

// Property names that exist on every JavaScript object. A plain-object allowlist would "find"
// them, so they must be treated as unknown sort keys.
const INHERITED_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

for (const key of INHERITED_KEYS) {
  test(`project list rejects inherited property "${key}" as sortBy with 400`, async () => {
    const { error, sent } = await run(projects.listProjects, {
      query: { sortBy: key }, workspace: { id: '1' }, params: { workspaceId: '1' },
    });
    assert.equal(sent, false);
    assert.equal(error?.status, 400, `expected a 400, got ${error?.name}: ${error?.message}`);
  });

  test(`workspace task list rejects inherited property "${key}" as sortBy with 400`, async () => {
    const { error, sent } = await run(tasks.listWorkspaceTasks, {
      query: { sortBy: key }, workspace: { id: '1' }, params: { workspaceId: '1' },
    });
    assert.equal(sent, false);
    assert.equal(error?.status, 400, `expected a 400, got ${error?.name}: ${error?.message}`);
  });
}

test('array and object sort parameters are rejected with 400', async () => {
  for (const sortBy of [['title', 'status'], { a: 1 }]) {
    const { error } = await run(tasks.listWorkspaceTasks, { query: { sortBy }, workspace: { id: '1' }, params: {} });
    assert.equal(error?.status, 400);
  }
  const { error } = await run(projects.listProjects, { query: { sortOrder: ['asc', 'desc'] }, workspace: { id: '1' }, params: {} });
  assert.equal(error?.status, 400);
});

test('SQL metacharacters in sort parameters are rejected, not executed', async () => {
  const payloads = ['title; DROP TABLE tasks', 'title--', "title' OR '1'='1", 'title,(SELECT pg_sleep(5))', 't.title'];
  for (const sortBy of payloads) {
    const t = await run(tasks.listWorkspaceTasks, { query: { sortBy }, workspace: { id: '1' }, params: {} });
    assert.equal(t.error?.status, 400, `tasks sortBy=${sortBy}`);
    const p = await run(projects.listProjects, { query: { sortBy }, workspace: { id: '1' }, params: {} });
    assert.equal(p.error?.status, 400, `projects sortBy=${sortBy}`);
  }
});

test('legitimate sort keys are still accepted by the parser (control)', async () => {
  // Parsing succeeds, so the handler proceeds to the database layer. With no database in this
  // test that surfaces as a non-400 error, which is exactly the control we want: NOT a 400.
  for (const sortBy of ['title', 'dueAt', 'position', 'createdAt']) {
    const { error } = await run(tasks.listWorkspaceTasks, { query: { sortBy }, workspace: { id: '1' }, params: {} });
    assert.notEqual(error?.status, 400, `tasks sortBy=${sortBy} must pass validation`);
  }
});
