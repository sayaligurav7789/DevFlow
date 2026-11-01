import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProject, createTask, createTestUser, createWorkspace, ctx, moveTask, pool, request, setupHarness } from '../test-support/stage7.js';

let wid;
let wid2;
let owner2;

setupHarness(async () => {
  owner2 = await createTestUser('owner2');
  wid = await createWorkspace('act', [[ctx.owner, 'owner'], [ctx.admin, 'admin'], [ctx.member, 'member']]);
  wid2 = await createWorkspace('act2', [[owner2, 'owner']]);
});

const feed = (query = '', user = ctx.owner, workspaceId = wid) => request(`/api/workspaces/${workspaceId}/activity${query}`, { user });
async function feedData(query = '', user = ctx.owner, workspaceId = wid) {
  const result = await feed(query, user, workspaceId);
  assert.equal(result.response.status, 200, result.data?.error?.message);
  return result.data;
}
const projectFeed = (projectId, query = '', user = ctx.owner) => request(`/api/projects/${projectId}/activity${query}`, { user });
const newerThan = (a, b) => new Date(a.createdAt) > new Date(b.createdAt) || (a.createdAt === b.createdAt && BigInt(a.id) > BigInt(b.id));

test('feed rows show actor, action, entity, project, and timestamp, newest first', async () => {
  const p = await createProject(wid, ctx.owner, 'Feed shape');
  const t = await createTask(p.id, ctx.member, { title: 'Shape task' });
  const patched = await request(`/api/projects/${p.id}/tasks/${t.id}`, { user: ctx.admin, method: 'PATCH', body: { title: 'Shape task v2', priority: 'urgent', status: 'in_progress' } });
  assert.equal(patched.response.status, 200);

  const { activity } = await feedData('?projectId=' + p.id);
  assert.deepEqual(activity.map((e) => e.action), ['task.status_changed', 'task.priority_changed', 'task.updated', 'task.created', 'project.created']);
  const [latest] = activity;
  assert.equal(latest.actorId, ctx.admin.id);
  assert.equal(latest.actorName, ctx.admin.displayName);
  assert.equal(latest.entityType, 'task');
  assert.equal(latest.entityId, t.id);
  assert.equal(latest.entityName, 'Shape task v2', 'shows the current task title');
  assert.equal(latest.projectId, p.id);
  assert.equal(latest.projectName, 'Feed shape');
  assert.deepEqual(latest.details.changes.status, { from: 'todo', to: 'in_progress' });
  assert.equal(new Date(latest.createdAt).toISOString(), latest.createdAt);
  const created = activity.find((e) => e.action === 'task.created');
  assert.equal(created.actorName, ctx.member.displayName);
  assert.equal(activity.at(-1).entityType, 'project');
  assert.equal(activity.at(-1).entityName, 'Feed shape');

  // One PATCH wrote three events in one transaction, so they share a timestamp: id breaks the tie.
  assert.equal(activity[0].createdAt, activity[2].createdAt);
  for (let i = 1; i < activity.length; i += 1) assert.ok(newerThan(activity[i - 1], activity[i]), `row ${i} is older than row ${i - 1}`);
});

test('pages concatenate to the full list without gaps or duplicates and totals are exact', async () => {
  const p = await createProject(wid, ctx.owner, 'Feed paging');
  for (let i = 1; i <= 12; i += 1) await createTask(p.id, ctx.owner, { title: `p${i}` });
  const full = await feedData(`?projectId=${p.id}&limit=100`);
  assert.equal(full.pagination.total, 13);
  const pages = [];
  for (let page = 1; page <= 3; page += 1) pages.push(...(await feedData(`?projectId=${p.id}&limit=5&page=${page}`)).activity.map((e) => e.id));
  assert.deepEqual(pages, full.activity.map((e) => e.id));
  assert.equal(new Set(pages).size, 13);
  const meta = (await feedData(`?projectId=${p.id}&limit=5&page=2`)).pagination;
  assert.deepEqual(meta, { page: 2, limit: 5, total: 13, totalPages: 3 });
  const beyond = await feedData(`?projectId=${p.id}&limit=5&page=9`);
  assert.deepEqual(beyond.activity, []);
  assert.equal(beyond.pagination.total, 13);
});

test('feed filters by entity type, project, and actor; membership events are opt-in', async () => {
  const p = await createProject(wid, ctx.owner, 'Feed filters');
  await createTask(p.id, ctx.member, { title: 'by member' });
  await createTask(p.id, ctx.owner, { title: 'by owner' });
  await pool.query(
    "INSERT INTO activity_logs (workspace_id, actor_id, action, entity_type, entity_id) VALUES ($1, $2, 'member.role_changed', 'member', $3)",
    [wid, ctx.owner.id, ctx.admin.id],
  );
  const types = (data) => [...new Set(data.activity.map((e) => e.entityType))].sort();
  assert.deepEqual(types(await feedData('?limit=100')), ['project', 'task'], 'default is task + project');
  assert.deepEqual(types(await feedData('?entityType=project&limit=100')), ['project']);
  assert.deepEqual(types(await feedData('?entityType=task&limit=100')), ['task']);
  assert.deepEqual(types(await feedData('?entityType=member')), ['member']);
  assert.deepEqual(types(await feedData('?entityType=task,member&limit=100')), ['member', 'task']);

  const byMember = await feedData(`?actorId=${ctx.member.id}&limit=100`);
  assert.ok(byMember.activity.length >= 1);
  assert.ok(byMember.activity.every((e) => e.actorId === ctx.member.id));
  const inProject = await feedData(`?projectId=${p.id}&limit=100`);
  assert.ok(inProject.activity.every((e) => e.projectId === p.id));
  assert.equal(inProject.pagination.total, 3);
});

test('feed rejects invalid input', async () => {
  for (const query of ['?entityType=bogus', '?entityType=', '?page=0', '?limit=0', '?limit=101', '?limit=x', '?projectId=abc', '?actorId=1;DROP', '?nope=1']) {
    assert.equal((await feed(query)).response.status, 400, `${query} should be rejected`);
  }
});

test('project feed covers the project and its tasks only, and keeps history after a task is deleted', async () => {
  const p = await createProject(wid, ctx.owner, 'History A');
  const other = await createProject(wid, ctx.owner, 'History B');
  const keep = await createTask(p.id, ctx.owner, { title: 'keep me' });
  const doomed = await createTask(p.id, ctx.owner, { title: 'doomed task' });
  await createTask(other.id, ctx.owner, { title: 'elsewhere' });
  await moveTask(p.id, keep.id, ctx.member, { status: 'done', afterTaskId: null });
  assert.equal((await request(`/api/projects/${p.id}/tasks/${doomed.id}`, { user: ctx.owner, method: 'DELETE' })).response.status, 200);

  const result = await projectFeed(p.id, '?limit=100');
  assert.equal(result.response.status, 200);
  const rows = result.data.activity;
  assert.ok(rows.every((e) => e.projectId === p.id), 'nothing from project B');
  assert.deepEqual(rows.map((e) => e.action), ['task.deleted', 'task.status_changed', 'task.created', 'task.created', 'project.created']);
  const deleted = rows[0];
  assert.equal(deleted.entityName, 'doomed task', 'deleted task keeps its name from the stored snapshot');
  assert.equal(deleted.projectName, 'History A');
  assert.equal(rows[1].actorName, ctx.member.displayName);
  assert.equal(result.data.pagination.total, 5);
});

test('project feed enforces authentication and project membership', async () => {
  const p = await createProject(wid, ctx.owner, 'History private');
  assert.equal((await projectFeed(p.id, '', ctx.member)).response.status, 200);
  assert.equal((await projectFeed(p.id, '', ctx.outsider)).response.status, 404);
  assert.equal((await projectFeed(p.id, '', owner2)).response.status, 404, 'owner of another workspace');
  assert.equal((await request(`/api/projects/${p.id}/activity`)).response.status, 401);
  assert.equal((await request('/api/projects/abc/activity', { user: ctx.owner })).response.status, 404);
  assert.equal((await request('/api/projects/999999999/activity', { user: ctx.owner })).response.status, 404);
  assert.equal((await projectFeed(p.id, '?x=1')).response.status, 400);
  assert.equal((await projectFeed(p.id, '?limit=0')).response.status, 400);
});

test('workspace feeds are isolated from each other', async () => {
  const mine = await createProject(wid, ctx.owner, 'Isolation mine');
  const theirs = await createProject(wid2, owner2, 'Isolation theirs');
  await createTask(theirs.id, owner2, { title: 'other workspace secret' });
  const names = (await feedData('?limit=100')).activity.map((e) => e.entityName);
  assert.ok(names.includes('Isolation mine'));
  assert.ok(!names.includes('Isolation theirs') && !names.includes('other workspace secret'));
  const theirFeed = (await feedData('?limit=100', owner2, wid2)).activity.map((e) => e.entityName);
  assert.ok(theirFeed.includes('other workspace secret') && !theirFeed.includes('Isolation mine'));
  assert.equal((await feed('', owner2, wid)).response.status, 404);
  assert.equal((await feed('', ctx.outsider)).response.status, 404);
  assert.equal((await request(`/api/workspaces/${wid}/activity`)).response.status, 401);
  // A project id from another workspace never leaks through the filter.
  assert.deepEqual((await feedData(`?projectId=${theirs.id}`)).activity, []);
  void mine;
});

test('project lifecycle events are attributed, and a deleted project stays in the workspace history', async () => {
  const p = await createProject(wid, ctx.admin, 'Lifecycle');
  const base = `/api/workspaces/${wid}/projects/${p.id}`;
  assert.equal((await request(base, { user: ctx.owner, method: 'PATCH', body: { description: 'changed' } })).response.status, 200);
  assert.equal((await request(`${base}/archive`, { user: ctx.owner, method: 'POST' })).response.status, 200);
  assert.equal((await request(`${base}/restore`, { user: ctx.admin, method: 'POST' })).response.status, 200);
  const rows = (await projectFeed(p.id)).data.activity;
  assert.deepEqual(rows.map((e) => e.action), ['project.restored', 'project.archived', 'project.updated', 'project.created']);
  assert.deepEqual(rows.map((e) => e.actorName), [ctx.admin, ctx.owner, ctx.owner, ctx.admin].map((u) => u.displayName));

  assert.equal((await request(base, { user: ctx.owner, method: 'DELETE' })).response.status, 200);
  const gone = (await feedData('?entityType=project&limit=100')).activity.find((e) => e.action === 'project.deleted' && e.entityName === 'Lifecycle');
  assert.ok(gone, 'project.deleted remains in the workspace feed with its name');
  assert.equal(gone.projectId, null, 'link to the deleted project is cleared');
  assert.equal((await projectFeed(p.id)).response.status, 404);
});

test('removing a member logs their unassigned tasks under the right project', async () => {
  const p = await createProject(wid, ctx.owner, 'Removal');
  const leaver = await createTestUser('leaver');
  await pool.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')", [wid, leaver.id]);
  const t = await createTask(p.id, ctx.owner, { title: 'was theirs', assigneeId: leaver.id });
  const removed = await request(`/api/workspaces/${wid}/members/${leaver.id}`, { user: ctx.owner, method: 'DELETE' });
  assert.equal(removed.response.status, 200);
  const row = (await projectFeed(p.id)).data.activity[0];
  assert.equal(row.action, 'task.unassigned');
  assert.equal(row.entityId, t.id);
  assert.equal(row.details.reason, 'member_removed');
  assert.equal(row.actorId, ctx.owner.id);
});

// The migration's own backfill statements are executed against rows that look like pre-Stage-7 data.
const migration = readFileSync(new URL('../db/migrations/005_kanban_dashboard_stage7.sql', import.meta.url), 'utf8');
const statement = (pattern) => {
  const found = migration.match(pattern);
  assert.ok(found, `migration statement not found: ${pattern}`);
  return found[0];
};

test('migration backfill links existing activity rows to their project', async () => {
  const p = await createProject(wid, ctx.owner, 'Backfill');
  const t = await createTask(p.id, ctx.owner, { title: 'legacy task' });
  await request(`/api/projects/${p.id}/tasks/${t.id}`, { user: ctx.owner, method: 'PATCH', body: { priority: 'high' } });
  await pool.query('UPDATE activity_logs SET project_id = NULL WHERE workspace_id = $1', [wid]);
  const before = await pool.query('SELECT COUNT(*)::INT AS n FROM activity_logs WHERE project_id = $1', [p.id]);
  assert.equal(before.rows[0].n, 0);

  await pool.query(statement(/UPDATE activity_logs a\s+SET project_id = p\.id[\s\S]*?;/));
  await pool.query(statement(/UPDATE activity_logs a\s+SET project_id = t\.project_id[\s\S]*?;/));
  const after = await pool.query(
    'SELECT entity_type, COUNT(*)::INT AS n FROM activity_logs WHERE project_id = $1 GROUP BY entity_type ORDER BY entity_type', [p.id],
  );
  assert.deepEqual(after.rows, [{ entity_type: 'project', n: 1 }, { entity_type: 'task', n: 2 }]);
});

test('migration backfill numbers existing tasks per column in creation order', async () => {
  const p = await createProject(wid, ctx.owner, 'Backfill positions');
  const ids = [];
  for (const title of ['one', 'two', 'three']) ids.push((await createTask(p.id, ctx.owner, { title })).id);
  const done = await createTask(p.id, ctx.owner, { title: 'solo', status: 'done' });
  await pool.query('UPDATE tasks SET position = 0 WHERE project_id = $1', [p.id]);

  await pool.query(statement(/UPDATE tasks t\s+SET position = ranked\.rank \* 1024[\s\S]*?;/));
  const rows = await pool.query(
    "SELECT id::TEXT AS id, position FROM tasks WHERE project_id = $1 AND status = 'todo' ORDER BY position", [p.id],
  );
  assert.deepEqual(rows.rows.map((r) => r.id), ids);
  assert.deepEqual(rows.rows.map((r) => r.position), [1024, 2048, 3072]);
  const solo = await pool.query('SELECT position FROM tasks WHERE id = $1', [done.id]);
  assert.equal(solo.rows[0].position, 1024, 'each column is numbered independently');
});
