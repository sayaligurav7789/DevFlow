// Dashboard cache service + Redis failure handling, against an in-memory Redis double.
// No database is needed.
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DEVFLOW_REDIS_COMMAND_TIMEOUT_MS = '60';
process.env.DEVFLOW_REDIS_BREAKER_COOLDOWN_MS = '100';

const [cache, redisLib, { FakeRedis }, { config }] = await Promise.all([
  import('../src/services/cache.service.js'),
  import('../src/lib/redis.js'),
  import('../test-support/fakeRedis.js'),
  import('../src/config/env.js'),
]);
const { readDashboardCache, writeDashboardCache, invalidateWorkspaceDashboard, dashboardCacheKeyParts } = cache;

let fake;
beforeEach(() => {
  fake = new FakeRedis();
  redisLib.setRedisClientForTests(fake);
});
afterEach(() => redisLib.setRedisClientForTests(null));

const payload = (label) => ({ generatedAt: '2026-10-22T00:00:00.000Z', label, tasks: { total: 3 } });

async function warm(workspaceId, userId, label = 'p') {
  const miss = await readDashboardCache(workspaceId, userId);
  assert.equal(miss.status, 'miss');
  assert.equal(await writeDashboardCache(workspaceId, userId, miss.version, payload(label)), true);
}

test('miss, then hit with the same payload; entries get the configured TTL', async () => {
  await warm('10', '1', 'first');
  const hit = await readDashboardCache('10', '1');
  assert.equal(hit.status, 'hit');
  assert.equal(hit.payload.label, 'first');

  const dataKeys = fake.keys().filter((key) => key.includes(':dashboard:ws:'));
  assert.equal(dataKeys.length, 1);
  const ttl = fake.ttlMs(dataKeys[0]);
  assert.ok(ttl > 0 && ttl <= config.cache.dashboardTtlSeconds * 1000);
  assert.equal(config.cache.dashboardTtlSeconds, 60, 'default TTL is 60 seconds');
});

test('cache keys are scoped by workspace and by user (isolation)', async () => {
  await warm('10', '1', 'ws10-user1');
  assert.equal((await readDashboardCache('11', '1')).status, 'miss', 'another workspace must not hit');
  assert.equal((await readDashboardCache('10', '2')).status, 'miss', 'another user must not hit');
  assert.equal((await readDashboardCache('10', '1')).payload.label, 'ws10-user1');

  const [key] = fake.keys().filter((k) => k.includes(':dashboard:ws:'));
  assert.match(key, /:dashboard:ws:10:u:1:\d{4}-\d{2}-\d{2}:/);
});

test('invalidation makes the next read a miss and the old entry is never served again', async () => {
  await warm('10', '1', 'old');
  assert.equal(await invalidateWorkspaceDashboard('10'), true);
  const after = await readDashboardCache('10', '1');
  assert.equal(after.status, 'miss');
  // The old entry still exists physically until its TTL, but it is unreachable.
  assert.ok(fake.keys().some((key) => key.includes(':dashboard:ws:10:u:1:')));
  await writeDashboardCache('10', '1', after.version, payload('new'));
  assert.equal((await readDashboardCache('10', '1')).payload.label, 'new');
});

test('invalidating one workspace leaves other workspaces cached', async () => {
  await warm('10', '1', 'a');
  await warm('20', '1', 'b');
  await invalidateWorkspaceDashboard('10');
  assert.equal((await readDashboardCache('10', '1')).status, 'miss');
  assert.equal((await readDashboardCache('20', '1')).status, 'hit');
});

test('invalidation covers every user of the workspace at once', async () => {
  await warm('10', '1');
  await warm('10', '2');
  await invalidateWorkspaceDashboard('10');
  assert.equal((await readDashboardCache('10', '1')).status, 'miss');
  assert.equal((await readDashboardCache('10', '2')).status, 'miss');
});

test('a read that raced a write cannot store stale data under the new version', async () => {
  const reader = await readDashboardCache('10', '1'); // reads PostgreSQL "before" the change...
  assert.equal(reader.status, 'miss');
  await invalidateWorkspaceDashboard('10'); // ...a write commits and invalidates...
  await writeDashboardCache('10', '1', reader.version, payload('stale')); // ...reader stores late.
  const next = await readDashboardCache('10', '1');
  assert.equal(next.status, 'miss', 'stale payload must be unreachable');
});

test('an entry whose stored scope does not match the request is rejected', async () => {
  const miss = await readDashboardCache('10', '1');
  const { dataKey } = dashboardCacheKeyParts();
  // Simulate a bug or key collision: workspace 99's data stored under workspace 10's key.
  await fake.setEx(dataKey('10', '1', miss.version, new Date()), 60, JSON.stringify({ workspaceId: '99', userId: '1', payload: payload('LEAK') }));
  assert.equal((await readDashboardCache('10', '1')).status, 'miss');
  await fake.setEx(dataKey('10', '1', miss.version, new Date()), 60, JSON.stringify({ workspaceId: '10', userId: '2', payload: payload('LEAK') }));
  assert.equal((await readDashboardCache('10', '1')).status, 'miss');
});

test('corrupted cache contents are treated as a miss', async () => {
  const miss = await readDashboardCache('10', '1');
  const { dataKey } = dashboardCacheKeyParts();
  await fake.setEx(dataKey('10', '1', miss.version, new Date()), 60, '{not json');
  assert.equal((await readDashboardCache('10', '1')).status, 'miss');
});

test('entries do not survive the UTC day boundary (overdue figures depend on today)', async () => {
  const today = new Date('2026-10-22T23:59:00.000Z');
  const tomorrow = new Date('2026-10-23T00:01:00.000Z');
  const miss = await readDashboardCache('10', '1', today);
  await writeDashboardCache('10', '1', miss.version, payload('yesterday'), today);
  assert.equal((await readDashboardCache('10', '1', today)).status, 'hit');
  assert.equal((await readDashboardCache('10', '1', tomorrow)).status, 'miss');
});

test('entries expire after the TTL', async () => {
  await warm('10', '1');
  fake.advance(config.cache.dashboardTtlSeconds * 1000 + 1);
  assert.equal((await readDashboardCache('10', '1')).status, 'miss');
});

test('Redis down: reads bypass, writes report failure, invalidation never throws', async () => {
  fake.failing = true;
  assert.deepEqual(await readDashboardCache('10', '1'), { status: 'bypass' });
  assert.equal(await writeDashboardCache('10', '1', '0', payload('x')), false);
  redisLib.resetRedisBreakerForTests();
  assert.equal(await invalidateWorkspaceDashboard('10'), false);
});

test('Redis stalled: the cache gives up within the command timeout', async () => {
  fake.hanging = true;
  const started = Date.now();
  assert.deepEqual(await readDashboardCache('10', '1'), { status: 'bypass' });
  assert.ok(Date.now() - started < 1000);
});

test('no Redis client at all (Redis disabled): reads bypass cleanly', async () => {
  redisLib.setRedisClientForTests(null);
  assert.deepEqual(await readDashboardCache('10', '1'), { status: 'bypass' });
  assert.equal(await invalidateWorkspaceDashboard('10'), false);
});

test('circuit breaker: after a failure Redis is skipped without being called, then retried after the cooldown', async () => {
  fake.failing = true;
  assert.equal((await readDashboardCache('10', '1')).status, 'bypass');
  const callsAfterFailure = fake.commandCount;
  for (let i = 0; i < 5; i += 1) await readDashboardCache('10', '1');
  assert.equal(fake.commandCount, callsAfterFailure, 'open breaker must not touch Redis');

  fake.failing = false;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal((await readDashboardCache('10', '1')).status, 'miss', 'recovered after cooldown');
});
