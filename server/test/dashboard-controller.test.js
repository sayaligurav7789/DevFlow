// The dashboard controller's cache flow, with PostgreSQL replaced by a counting fake client and
// Redis by an in-memory double. Proves: a hit never touches PostgreSQL, scope (workspace/user)
// separates entries, invalidation forces a recompute, Redis failure falls back to PostgreSQL, and
// a failed query is never cached. (Authorization is enforced by requireWorkspaceAccess before this
// controller runs; test/dashboard-cache.test.js covers that end to end.)
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DEVFLOW_REDIS_COMMAND_TIMEOUT_MS = '60';

const [{ getDashboard }, { pool }, redisLib, cache, { FakeRedis }] = await Promise.all([
  import('../src/controllers/dashboard.controller.js'),
  import('../src/db/pool.js'),
  import('../src/lib/redis.js'),
  import('../src/services/cache.service.js'),
  import('../test-support/fakeRedis.js'),
]);

const STATS = {
  activeProjects: 2, archivedProjects: 1, total: 10, backlog: 1, todo: 3, in_progress: 2, in_review: 1,
  done: 3, overdue: 1, mineTotal: 4, mineOpen: 3, mineDone: 1, mineOverdue: 0,
};

let fake;
let connects;
let failQueries;
const originalConnect = pool.connect;

beforeEach(() => {
  fake = new FakeRedis();
  redisLib.setRedisClientForTests(fake);
  connects = 0;
  failQueries = false;
  pool.connect = async () => {
    connects += 1;
    return {
      query: async (sql) => {
        if (failQueries && !/^(BEGIN|ROLLBACK)/.test(sql)) throw new Error('simulated PostgreSQL failure');
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
        return sql.includes('"activeProjects"') ? { rows: [STATS] } : { rows: [] };
      },
      release() {},
    };
  };
});

afterEach(() => {
  pool.connect = originalConnect;
  redisLib.setRedisClientForTests(null);
});

async function call(workspaceId, userId) {
  const req = { workspace: { id: workspaceId }, user: { id: userId } };
  const headers = {};
  let body;
  let error;
  const res = { set(name, value) { headers[name.toLowerCase()] = value; return this; }, json(payload) { body = payload; return this; } };
  await getDashboard(req, res, (e) => { error = e; });
  return { headers, body, error };
}

test('MISS computes from PostgreSQL and stores; the next call is a HIT that never touches PostgreSQL', async () => {
  const first = await call('10', '1');
  assert.equal(first.headers['x-cache'], 'MISS');
  assert.equal(first.body.tasks.total, 10);
  assert.equal(first.body.assignedToMe.total, 4);
  assert.equal(connects, 1);

  const second = await call('10', '1');
  assert.equal(second.headers['x-cache'], 'HIT');
  assert.deepEqual(second.body, first.body);
  assert.equal(connects, 1, 'a cache hit must not open a PostgreSQL connection');
});

test('different user or different workspace is a separate entry', async () => {
  await call('10', '1');
  assert.equal((await call('10', '2')).headers['x-cache'], 'MISS');
  assert.equal((await call('11', '1')).headers['x-cache'], 'MISS');
  assert.equal(connects, 3);
  assert.equal((await call('10', '1')).headers['x-cache'], 'HIT');
  assert.equal((await call('10', '2')).headers['x-cache'], 'HIT');
  assert.equal((await call('11', '1')).headers['x-cache'], 'HIT');
  assert.equal(connects, 3);
});

test('invalidating the workspace forces a recompute for every user, and only that workspace', async () => {
  await call('10', '1');
  await call('10', '2');
  await call('11', '1');
  await cache.invalidateWorkspaceDashboard('10');
  assert.equal((await call('10', '1')).headers['x-cache'], 'MISS');
  assert.equal((await call('10', '2')).headers['x-cache'], 'MISS');
  assert.equal((await call('11', '1')).headers['x-cache'], 'HIT');
});

test('Redis down: PostgreSQL answers every request, flagged BYPASS, nothing is stored', async () => {
  fake.failing = true;
  const first = await call('10', '1');
  const second = await call('10', '1');
  assert.equal(first.error, undefined);
  assert.equal(first.headers['x-cache'], 'BYPASS');
  assert.equal(first.body.tasks.total, 10);
  assert.equal(second.headers['x-cache'], 'BYPASS');
  assert.equal(connects, 2);
  assert.equal(fake.keys().length, 0);
});

test('Redis stalled: the request still completes from PostgreSQL', async () => {
  fake.hanging = true;
  const started = Date.now();
  const result = await call('10', '1');
  assert.equal(result.headers['x-cache'], 'BYPASS');
  assert.equal(result.body.tasks.total, 10);
  assert.ok(Date.now() - started < 1500);
});

test('Redis recovers: caching resumes', async () => {
  fake.failing = true;
  assert.equal((await call('10', '1')).headers['x-cache'], 'BYPASS');
  fake.failing = false;
  await new Promise((resolve) => setTimeout(resolve, 5100)); // default breaker cooldown is 5s
  assert.equal((await call('10', '1')).headers['x-cache'], 'MISS');
  assert.equal((await call('10', '1')).headers['x-cache'], 'HIT');
});

test('a PostgreSQL failure is passed to the error handler and is never cached', async () => {
  failQueries = true;
  const failed = await call('10', '1');
  assert.ok(failed.error instanceof Error);
  assert.equal(failed.body, undefined);
  assert.equal(fake.keys().filter((key) => key.includes(':dashboard:ws:')).length, 0);

  failQueries = false;
  const ok = await call('10', '1');
  assert.equal(ok.headers['x-cache'], 'MISS');
  assert.equal(ok.body.tasks.total, 10);
});

test('the cached payload keeps the original response shape (no cache metadata leaks into the body)', async () => {
  const first = await call('10', '1');
  const hit = await call('10', '1');
  assert.deepEqual(Object.keys(hit.body).sort(), Object.keys(first.body).sort());
  assert.deepEqual(Object.keys(first.body).sort(), [
    'assignedToMe', 'generatedAt', 'projectProgress', 'projects', 'recentActivity', 'tasks', 'upcomingDeadlines',
  ]);
});
