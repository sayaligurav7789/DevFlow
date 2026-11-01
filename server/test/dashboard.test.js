import assert from 'node:assert/strict';
import test from 'node:test';
import { countQueries, createProject, createTask, createTestUser, createWorkspace, ctx, day, moveTask, pool, request, runId, setupHarness } from '../test-support/stage7.js';


let wid; // main dashboard workspace
let wid2; // second workspace that must never leak into the first
let owner2;
let P; // projects by key
let T; // tasks by key

const dash = (workspaceId, user = ctx.owner) => request(`/api/workspaces/${workspaceId}/dashboard`, { user });
async function dashboard(workspaceId, user = ctx.owner) {
  const result = await dash(workspaceId, user);
  assert.equal(result.response.status, 200, result.data?.error?.message);
  return result.data;
}

// Dataset (owner O, member M). Today is day(0); "overdue" means due before today and not done.
//  Alpha  a1 backlog | a2 todo overdue(M) | a3 todo +2d(O) | a4 in_progress today(M) | a5 in_review +20d(O)
//         a6 done(M) | a7 done(O) | a8 todo +2d
//  Beta   b1 todo -1d(O) | b2 in_progress +13d(M) | b3 todo +14d
//  Gamma  (archived) g1 todo -5d(M) | g2 todo +1d      Delta (active, no tasks)
setupHarness(async () => {
  owner2 = await createTestUser('owner2');
  wid = await createWorkspace('dash', [[ctx.owner, 'owner'], [ctx.member, 'member']]);
  wid2 = await createWorkspace('dash2', [[owner2, 'owner']]);
  const O = ctx.owner.id;
  const M = ctx.member.id;
  P = {};
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) P[name] = await createProject(wid, ctx.owner, name);
  const mk = (project, title, fields) => createTask(project.id, ctx.owner, { title, ...fields });
  T = {};
  T.a1 = await mk(P.Alpha, 'a1', { status: 'backlog' });
  T.a2 = await mk(P.Alpha, 'a2', { status: 'todo', dueAt: day(-3), assigneeId: M, priority: 'high' });
  T.a3 = await mk(P.Alpha, 'a3', { status: 'todo', dueAt: day(2), assigneeId: O });
  T.a4 = await mk(P.Alpha, 'a4', { status: 'in_progress', dueAt: day(0), assigneeId: M });
  T.a5 = await mk(P.Alpha, 'a5', { status: 'in_review', dueAt: day(20), assigneeId: O });
  T.a6 = await mk(P.Alpha, 'a6', { status: 'done', dueAt: day(-10), assigneeId: M });
  T.a7 = await mk(P.Alpha, 'a7', { status: 'done', assigneeId: O });
  T.a8 = await mk(P.Alpha, 'a8', { status: 'todo', dueAt: day(2) });
  T.b1 = await mk(P.Beta, 'b1', { status: 'todo', dueAt: day(-1), assigneeId: O });
  T.b2 = await mk(P.Beta, 'b2', { status: 'in_progress', dueAt: day(13), assigneeId: M });
  T.b3 = await mk(P.Beta, 'b3', { status: 'todo', dueAt: day(14) });
  T.g1 = await mk(P.Gamma, 'g1', { status: 'todo', dueAt: day(-5), assigneeId: M });
  T.g2 = await mk(P.Gamma, 'g2', { status: 'todo', dueAt: day(1) });
  const archived = await request(`/api/workspaces/${wid}/projects/${P.Gamma.id}/archive`, { user: ctx.owner, method: 'POST' });
  assert.equal(archived.response.status, 200);

  // A second workspace full of data that must not change any number above.
  const other = await createProject(wid2, owner2, 'Leaky');
  for (let i = 1; i <= 5; i += 1) {
    await createTask(other.id, owner2, { title: `LEAK-${i}`, status: i % 2 ? 'done' : 'todo', dueAt: day(-2), assigneeId: owner2.id });
  }
  // A membership event the default feed must not show.
  await pool.query(
    "INSERT INTO activity_logs (workspace_id, actor_id, action, entity_type, entity_id) VALUES ($1, $2, 'member.role_changed', 'member', $2)",
    [wid, ctx.owner.id],
  );
});

test('dashboard totals, completion, overdue, and status distribution are exact', async () => {
  const d = await dashboard(wid);
  assert.deepEqual(d.projects, { active: 3, archived: 1 });
  assert.equal(d.tasks.total, 11);
  assert.equal(d.tasks.completed, 2);
  assert.equal(d.tasks.open, 9);
  assert.equal(d.tasks.overdue, 2, 'a2 and b1 only: done tasks and archived projects are not overdue');
  assert.equal(d.tasks.completionRate, 18);
  assert.deepEqual(d.tasks.byStatus, { backlog: 1, todo: 5, in_progress: 2, in_review: 1, done: 2 });
  assert.equal(Object.values(d.tasks.byStatus).reduce((a, b) => a + b, 0), d.tasks.total);
});

test('tasks assigned to the current user are counted per user', async () => {
  assert.deepEqual((await dashboard(wid, ctx.member)).assignedToMe, { total: 4, open: 3, completed: 1, overdue: 1 });
  assert.deepEqual((await dashboard(wid, ctx.owner)).assignedToMe, { total: 4, open: 3, completed: 1, overdue: 1 });
  // Same workspace-wide numbers for every member.
  assert.equal((await dashboard(wid, ctx.member)).tasks.total, 11);
});

test('project progress is exact, excludes archived projects, and sorts by last update', async () => {
  let d = await dashboard(wid);
  const byName = Object.fromEntries(d.projectProgress.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(byName).sort(), ['Alpha', 'Beta', 'Delta']);
  assert.deepEqual([byName.Alpha.totalTasks, byName.Alpha.doneTasks, byName.Alpha.progress], [8, 2, 25]);
  assert.deepEqual([byName.Beta.totalTasks, byName.Beta.doneTasks, byName.Beta.progress], [3, 0, 0]);
  assert.deepEqual([byName.Delta.totalTasks, byName.Delta.doneTasks, byName.Delta.progress], [0, 0, 0]);
  assert.deepEqual(d.projectProgress.map((p) => p.name), ['Delta', 'Beta', 'Alpha']);

  const renamed = await request(`/api/workspaces/${wid}/projects/${P.Alpha.id}`, { user: ctx.owner, method: 'PATCH', body: { description: 'touch' } });
  assert.equal(renamed.response.status, 200);
  d = await dashboard(wid);
  assert.deepEqual(d.projectProgress.map((p) => p.name), ['Alpha', 'Delta', 'Beta']);
});

test('upcoming deadlines honour the window, skip done/overdue/archived, and sort by date then id', async () => {
  const d = await dashboard(wid);
  assert.equal(d.upcomingDeadlines.windowDays, 14);
  assert.deepEqual(d.upcomingDeadlines.tasks.map((t) => t.title), ['a4', 'a3', 'a8', 'b2']);
  const [today, , , last] = d.upcomingDeadlines.tasks;
  assert.equal(today.dueAt.slice(0, 10), day(0), 'a task due today is upcoming, not overdue');
  assert.equal(last.dueAt.slice(0, 10), day(13), 'day +14 is outside the window');
  assert.equal(today.assigneeName, ctx.member.displayName);
  assert.equal(today.projectName, 'Alpha');
  assert.ok(Number(T.a3.id) < Number(T.a8.id));
});

test('recent activity is newest-first, workspace-scoped, and excludes membership events by default', async () => {
  const d = await dashboard(wid);
  assert.equal(d.recentActivity.length, 10);
  for (let i = 1; i < d.recentActivity.length; i += 1) {
    const a = d.recentActivity[i - 1];
    const b = d.recentActivity[i];
    const newer = new Date(a.createdAt) > new Date(b.createdAt)
      || (a.createdAt === b.createdAt && BigInt(a.id) > BigInt(b.id));
    assert.ok(newer, 'ordered by createdAt then id, descending');
  }
  assert.ok(d.recentActivity.every((e) => ['task', 'project'].includes(e.entityType)));
  assert.ok(d.recentActivity.every((e) => e.actorName && e.createdAt && e.action && e.entityId));
  assert.ok(!d.recentActivity.some((e) => e.entityName?.startsWith('LEAK-')), 'no events from another workspace');
  assert.equal(d.recentActivity[0].action, 'project.updated');
  assert.equal(d.recentActivity[0].entityName, 'Alpha');
});

test('dashboard reflects a move immediately (no stale cache) and logs it as the newest activity', async () => {
  const before = await dashboard(wid);
  const moved = await moveTask(P.Alpha.id, T.a1.id, ctx.member, { status: 'in_review', afterTaskId: null });
  assert.equal(moved.response.status, 200);
  const after = await dashboard(wid);
  assert.equal(after.tasks.byStatus.backlog, before.tasks.byStatus.backlog - 1);
  assert.equal(after.tasks.byStatus.in_review, before.tasks.byStatus.in_review + 1);
  assert.equal(after.tasks.total, before.tasks.total);
  const [latest] = after.recentActivity;
  assert.equal(latest.action, 'task.status_changed');
  assert.equal(latest.entityName, 'a1');
  assert.equal(latest.actorName, ctx.member.displayName);
  assert.equal(latest.projectName, 'Alpha');
  assert.deepEqual(latest.details.changes.status, { from: 'backlog', to: 'in_review' });

  const done = await moveTask(P.Alpha.id, T.a8.id, ctx.owner, { status: 'done', afterTaskId: null });
  assert.equal(done.response.status, 200);
  const finished = await dashboard(wid);
  assert.equal(finished.tasks.completed, 3);
  assert.equal(finished.tasks.completionRate, 27);
  assert.deepEqual(finished.upcomingDeadlines.tasks.map((t) => t.title), ['a4', 'a3', 'b2'], 'completed task leaves the deadline list');
});

test('workspace isolation: other workspaces are invisible and cannot be read', async () => {
  const d2 = await dashboard(wid2, owner2);
  assert.equal(d2.tasks.total, 5);
  assert.equal(d2.tasks.completed, 3);
  assert.equal(d2.tasks.overdue, 2);
  assert.deepEqual(d2.assignedToMe, { total: 5, open: 2, completed: 3, overdue: 2 });
  assert.equal((await dash(wid, owner2)).response.status, 404, 'member of another workspace');
  assert.equal((await dash(wid, ctx.outsider)).response.status, 404, 'not a member anywhere');
  assert.equal((await dash(wid2, ctx.owner)).response.status, 404);
  assert.equal((await request(`/api/workspaces/${wid}/dashboard`)).response.status, 401);
  assert.equal((await request('/api/workspaces/abc/dashboard', { user: ctx.owner })).response.status, 404);
  assert.equal((await request('/api/workspaces/999999999/dashboard', { user: ctx.owner })).response.status, 404);
});

test('an empty workspace returns zeros and empty lists', async () => {
  const empty = await createWorkspace('dash-empty', [[ctx.owner, 'owner']]);
  const d = await dashboard(empty);
  assert.deepEqual(d.projects, { active: 0, archived: 0 });
  assert.equal(d.tasks.total, 0);
  assert.equal(d.tasks.completionRate, 0);
  assert.deepEqual(d.tasks.byStatus, { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 });
  assert.deepEqual(d.assignedToMe, { total: 0, open: 0, completed: 0, overdue: 0 });
  assert.deepEqual(d.projectProgress, []);
  assert.deepEqual(d.upcomingDeadlines.tasks, []);
  assert.deepEqual(d.recentActivity, []);
});

test('the number of database statements does not grow with the amount of data (no N+1)', async () => {
  const empty = await createWorkspace('dash-count', [[ctx.owner, 'owner']]);
  const small = await countQueries(() => dashboard(empty));
  const large = await countQueries(() => dashboard(wid));
  assert.equal(large, small, 'same statements for 0 and 25+ tasks/projects/events');
  assert.ok(large <= 12, `dashboard used ${large} statements`);
});

test('every dashboard response is an internally consistent snapshot while tasks change concurrently', async () => {
  const project = await createProject(wid, ctx.owner, `Churn ${runId}`);
  const writers = Array.from({ length: 12 }, (_, i) => createTask(project.id, ctx.owner, { title: `churn-${i}`, status: i % 2 ? 'done' : 'todo' }));
  const readers = Array.from({ length: 12 }, () => dashboard(wid));
  const snapshots = (await Promise.all([...readers, ...writers])).slice(0, 12);
  for (const s of snapshots) {
    assert.equal(Object.values(s.tasks.byStatus).reduce((a, b) => a + b, 0), s.tasks.total);
    assert.equal(s.tasks.completed, s.tasks.byStatus.done);
    assert.equal(s.tasks.open, s.tasks.total - s.tasks.completed);
  }
});
