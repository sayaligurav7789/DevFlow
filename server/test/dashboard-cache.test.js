// Dashboard caching through the real HTTP stack: invalidation, workspace isolation, authorization
// and Redis failure. Requires PostgreSQL (DEVFLOW_DB_NAME must end in _test), like the other
// integration tests; Redis is replaced by an in-memory double.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  createProject, createTask, createTestUser, createWorkspace, ctx, moveTask, request, setupHarness,
} from '../test-support/stage7.js';
import { FakeRedis } from '../test-support/fakeRedis.js';

// Loaded after the harness so SESSION_SECRET is already set when config is evaluated.
const redisLib = await import('../src/lib/redis.js');
const fake = new FakeRedis();

let wsB;
let ownerB;
let projectB;

setupHarness(async () => {
  redisLib.setRedisClientForTests(fake);
  ownerB = await createTestUser('ownerB');
  wsB = await createWorkspace('cacheB', [[ownerB, 'owner']]);
  projectB = await createProject(wsB, ownerB, 'B project');
});
after(() => redisLib.setRedisClientForTests(null));

const dash = (workspaceId, user) => request(`/api/workspaces/${workspaceId}/dashboard`, { user });
const xcache = (result) => result.response.headers.get('x-cache');

async function get(workspaceId, user, expected) {
  const result = await dash(workspaceId, user);
  assert.equal(result.response.status, 200, result.data?.error?.message);
  if (expected) assert.equal(xcache(result), expected);
  return result;
}

test('the second request is served from Redis with an identical body', async () => {
  const first = await get(ctx.workspaceId, ctx.owner, 'MISS');
  const second = await get(ctx.workspaceId, ctx.owner, 'HIT');
  assert.deepEqual(second.data, first.data);
});

test('cached entries carry the workspace id and expire (TTL is set)', async () => {
  await get(ctx.workspaceId, ctx.owner);
  const keys = fake.keys().filter((key) => key.includes(`:dashboard:ws:${ctx.workspaceId}:u:${ctx.owner.id}:`));
  assert.ok(keys.length >= 1);
  for (const key of keys) {
    const ttl = fake.ttlMs(key);
    assert.ok(ttl > 0 && ttl <= 60_000, `ttl ${ttl}`);
  }
});

test('creating, updating, moving and deleting a task each invalidate the cache', async () => {
  await get(ctx.workspaceId, ctx.owner, 'MISS');
  const before = (await get(ctx.workspaceId, ctx.owner, 'HIT')).data.tasks.total;

  const task = await createTask(ctx.project.id, ctx.owner, { title: 'Cache me', status: 'todo' });
  const afterCreate = await get(ctx.workspaceId, ctx.owner, 'MISS');
  assert.equal(afterCreate.data.tasks.total, before + 1);
  assert.equal((await get(ctx.workspaceId, ctx.owner, 'HIT')).data.tasks.total, before + 1);

  const patched = await request(`/api/projects/${ctx.project.id}/tasks/${task.id}`, {
    user: ctx.owner, method: 'PATCH', body: { status: 'done' },
  });
  assert.equal(patched.response.status, 200);
  const afterPatch = await get(ctx.workspaceId, ctx.owner, 'MISS');
  assert.equal(afterPatch.data.tasks.byStatus.done, afterCreate.data.tasks.byStatus.done + 1);
  await get(ctx.workspaceId, ctx.owner, 'HIT');

  const moved = await moveTask(ctx.project.id, task.id, ctx.owner, { status: 'in_review', afterTaskId: null });
  assert.equal(moved.response.status, 200);
  const afterMove = await get(ctx.workspaceId, ctx.owner, 'MISS');
  assert.equal(afterMove.data.tasks.byStatus.in_review, afterPatch.data.tasks.byStatus.in_review + 1);
  await get(ctx.workspaceId, ctx.owner, 'HIT');

  const deleted = await request(`/api/projects/${ctx.project.id}/tasks/${task.id}`, { user: ctx.owner, method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  assert.equal((await get(ctx.workspaceId, ctx.owner, 'MISS')).data.tasks.total, before);
});

test('reordering inside a column does not invalidate (nothing the dashboard shows changed)', async () => {
  const a = await createTask(ctx.project.id, ctx.owner, { title: 'order-a', status: 'backlog' });
  const b = await createTask(ctx.project.id, ctx.owner, { title: 'order-b', status: 'backlog' });
  await get(ctx.workspaceId, ctx.owner, 'MISS');
  const moved = await moveTask(ctx.project.id, b.id, ctx.owner, { status: 'backlog', afterTaskId: null });
  assert.equal(moved.response.status, 200);
  await get(ctx.workspaceId, ctx.owner, 'HIT');
  assert.ok(a.id);
});

test('project create, rename, archive, restore and delete each invalidate the cache', async () => {
  await get(ctx.workspaceId, ctx.owner, 'MISS');
  const project = await createProject(ctx.workspaceId, ctx.owner, 'Cache project');
  const afterCreate = await get(ctx.workspaceId, ctx.owner, 'MISS');
  const activeAfterCreate = afterCreate.data.projects.active;

  const renamed = await request(`/api/workspaces/${ctx.workspaceId}/projects/${project.id}`, {
    user: ctx.owner, method: 'PATCH', body: { name: 'Cache project renamed' },
  });
  assert.equal(renamed.response.status, 200);
  await get(ctx.workspaceId, ctx.owner, 'MISS');

  await get(ctx.workspaceId, ctx.owner, 'HIT');
  const archived = await request(`/api/workspaces/${ctx.workspaceId}/projects/${project.id}/archive`, { user: ctx.owner, method: 'POST' });
  assert.equal(archived.response.status, 200);
  const afterArchive = await get(ctx.workspaceId, ctx.owner, 'MISS');
  assert.equal(afterArchive.data.projects.active, activeAfterCreate - 1);

  await get(ctx.workspaceId, ctx.owner, 'HIT');
  const restored = await request(`/api/workspaces/${ctx.workspaceId}/projects/${project.id}/restore`, { user: ctx.owner, method: 'POST' });
  assert.equal(restored.response.status, 200);
  assert.equal((await get(ctx.workspaceId, ctx.owner, 'MISS')).data.projects.active, activeAfterCreate);

  await get(ctx.workspaceId, ctx.owner, 'HIT');
  const removed = await request(`/api/workspaces/${ctx.workspaceId}/projects/${project.id}`, { user: ctx.owner, method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  assert.equal((await get(ctx.workspaceId, ctx.owner, 'MISS')).data.projects.active, activeAfterCreate - 1);
});

test('workspaces are isolated: a change in B never touches or leaks into A', async () => {
  const a1 = await get(ctx.workspaceId, ctx.owner, 'MISS');
  await get(wsB, ownerB, 'MISS');
  await get(ctx.workspaceId, ctx.owner, 'HIT');
  await get(wsB, ownerB, 'HIT');

  await createTask(projectB.id, ownerB, { title: 'ISOLATION-LEAK-CHECK', status: 'todo' });
  await get(ctx.workspaceId, ctx.owner, 'HIT'); // A was not invalidated by B's write
  const bAfter = await get(wsB, ownerB, 'MISS');
  assert.equal(bAfter.data.tasks.total, 1);

  const a2 = await get(ctx.workspaceId, ctx.owner, 'HIT');
  assert.deepEqual(a2.data, a1.data);
  assert.ok(!JSON.stringify(a2.data).includes('ISOLATION-LEAK-CHECK'));
});

test('authorization is checked before the cache: non-members and anonymous callers never see cached data', async () => {
  await get(ctx.workspaceId, ctx.owner, 'MISS'); // warm
  await get(ctx.workspaceId, ctx.owner, 'HIT');

  const outsider = await dash(ctx.workspaceId, ctx.outsider);
  assert.equal(outsider.response.status, 404);
  assert.notEqual(xcache(outsider), 'HIT');
  assert.equal(outsider.data.tasks, undefined);

  const anonymous = await dash(ctx.workspaceId, undefined);
  assert.equal(anonymous.response.status, 401);

  // Another workspace's owner cannot read this workspace either.
  const crossTenant = await dash(ctx.workspaceId, ownerB);
  assert.equal(crossTenant.response.status, 404);
});

test('a removed member loses access immediately even though their cached entry is still alive', async () => {
  const leaver = await createTestUser('leaver');
  const wid = await createWorkspace('cacheLeaver', [[ctx.owner, 'owner'], [leaver, 'member']]);
  await get(wid, leaver, 'MISS');
  await get(wid, leaver, 'HIT');
  assert.ok(fake.keys().some((key) => key.includes(`:dashboard:ws:${wid}:u:${leaver.id}:`)));

  const removed = await request(`/api/workspaces/${wid}/members/${leaver.id}`, { user: ctx.owner, method: 'DELETE' });
  assert.equal(removed.response.status, 200);

  const afterRemoval = await dash(wid, leaver);
  assert.equal(afterRemoval.response.status, 404);
  assert.equal(afterRemoval.data.tasks, undefined);
});

test('assignedToMe is per user: warm caches for two users never mix', async () => {
  const project = await createProject(ctx.workspaceId, ctx.owner, 'Per-user');
  await createTask(project.id, ctx.owner, { title: 'mine-member', assigneeId: ctx.member.id, status: 'todo' });
  const ownerView = await get(ctx.workspaceId, ctx.owner, 'MISS');
  const memberView = await get(ctx.workspaceId, ctx.member, 'MISS');
  assert.ok(memberView.data.assignedToMe.total >= 1);
  assert.equal(ownerView.data.assignedToMe.total, 0);

  const ownerAgain = await get(ctx.workspaceId, ctx.owner, 'HIT');
  const memberAgain = await get(ctx.workspaceId, ctx.member, 'HIT');
  assert.equal(ownerAgain.data.assignedToMe.total, 0);
  assert.equal(memberAgain.data.assignedToMe.total, memberView.data.assignedToMe.total);
});

test('Redis outage: the dashboard is served from PostgreSQL, writes still succeed, and caching resumes after recovery', async () => {
  await get(ctx.workspaceId, ctx.owner);
  fake.failing = true;
  redisLib.resetRedisBreakerForTests();

  const during = await get(ctx.workspaceId, ctx.owner, 'BYPASS');
  assert.equal(typeof during.data.tasks.total, 'number');

  const task = await createTask(ctx.project.id, ctx.owner, { title: 'created during outage', status: 'todo' });
  assert.ok(task.id, 'task writes must not depend on Redis');
  redisLib.resetRedisBreakerForTests();
  const fresh = await get(ctx.workspaceId, ctx.owner, 'BYPASS');
  assert.equal(fresh.data.tasks.total, during.data.tasks.total + 1, 'PostgreSQL data is current while Redis is down');

  fake.failing = false;
  redisLib.resetRedisBreakerForTests();
  // Entries written before the outage may still be served for at most the TTL (documented in the
  // README), so recovery is asserted on the cache mechanism, not on freshness of that one entry.
  const recovered = await dash(ctx.workspaceId, ctx.owner);
  assert.equal(recovered.response.status, 200);
  assert.ok(['HIT', 'MISS'].includes(xcache(recovered)));
});

test('a stalled Redis does not hang the dashboard', async () => {
  fake.hanging = true;
  redisLib.resetRedisBreakerForTests();
  const started = Date.now();
  const result = await get(ctx.workspaceId, ctx.owner, 'BYPASS');
  assert.ok(Date.now() - started < 3000);
  assert.equal(typeof result.data.tasks.total, 'number');
  fake.hanging = false;
  redisLib.resetRedisBreakerForTests();
});
