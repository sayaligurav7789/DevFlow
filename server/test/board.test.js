import assert from 'node:assert/strict';
import test from 'node:test';
import { board, column, createProject, createTask, createWorkspace, createTestUser, ctx, moveTask, pool, request, setupHarness, titles } from '../test-support/stage7.js';

setupHarness();

async function freshProject(name) {
  return createProject(ctx.workspaceId, ctx.owner, name);
}
async function getTask(projectId, taskId, user = ctx.owner) {
  const result = await request(`/api/projects/${projectId}/tasks/${taskId}`, { user });
  assert.equal(result.response.status, 200);
  return result.data.task;
}

test('board returns the five columns in order with totals and cards in creation order', async () => {
  const p = await freshProject('Board basics');
  const a = await createTask(p.id, ctx.owner, { title: 'A', status: 'todo', priority: 'high', assigneeId: ctx.member.id, dueAt: '2031-05-01' });
  await createTask(p.id, ctx.owner, { title: 'B', status: 'todo' });
  await createTask(p.id, ctx.owner, { title: 'C', status: 'todo' });
  await createTask(p.id, ctx.owner, { title: 'D', status: 'backlog' });
  await createTask(p.id, ctx.owner, { title: 'E', status: 'done' });

  const data = await board(p.id, ctx.member);
  assert.deepEqual(data.columns.map((c) => c.status), ['backlog', 'todo', 'in_progress', 'in_review', 'done']);
  assert.deepEqual(data.columns.map((c) => c.total), [1, 3, 0, 0, 1]);
  assert.deepEqual(titles(data, 'todo'), ['A', 'B', 'C']);
  assert.equal(data.archived, false);

  const card = column(data, 'todo').tasks[0];
  assert.equal(card.id, a.id);
  assert.equal(card.priority, 'high');
  assert.equal(card.assigneeId, ctx.member.id);
  assert.equal(card.assigneeName, ctx.member.displayName);
  assert.equal(new Date(card.dueAt).toISOString().slice(0, 10), '2031-05-01');
});

test('board limits cards per column but keeps true totals; list endpoint loads the rest in board order', async () => {
  const p = await freshProject('Board limit');
  for (let i = 1; i <= 7; i += 1) await createTask(p.id, ctx.owner, { title: `T${i}`, status: 'todo' });
  const data = await board(p.id, ctx.owner, '?limit=3');
  assert.equal(column(data, 'todo').total, 7);
  assert.deepEqual(titles(data, 'todo'), ['T1', 'T2', 'T3']);

  const more = await request(`/api/projects/${p.id}/tasks?status=todo&sortBy=position&sortOrder=asc&limit=3&page=2`, { user: ctx.owner });
  assert.equal(more.response.status, 200);
  assert.deepEqual(more.data.tasks.map((t) => t.title), ['T4', 'T5', 'T6']);
});

test('board filters by search, priority, and assignee and reports filtered totals', async () => {
  const p = await freshProject('Board filters');
  await createTask(p.id, ctx.owner, { title: 'Fix login', priority: 'urgent', assigneeId: ctx.member.id });
  await createTask(p.id, ctx.owner, { title: 'Write docs', priority: 'low' });
  await createTask(p.id, ctx.owner, { title: 'Login polish', priority: 'low', assigneeId: ctx.member.id, status: 'in_review' });

  assert.equal(column(await board(p.id, ctx.owner, '?q=login'), 'todo').total, 1);
  const byPriority = await board(p.id, ctx.owner, '?priority=low');
  assert.deepEqual(byPriority.columns.map((c) => c.total), [0, 1, 0, 1, 0]);
  const mine = await board(p.id, ctx.owner, `?assigneeId=${ctx.member.id}`);
  assert.deepEqual(mine.columns.map((c) => c.total), [0, 1, 0, 1, 0]);
  const none = await board(p.id, ctx.owner, '?assigneeId=unassigned');
  assert.deepEqual(titles(none, 'todo'), ['Write docs']);
});

test('board rejects invalid input and enforces authentication and project access', async () => {
  const p = await freshProject('Board access');
  for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?priority=huge', '?assigneeId=abc', '?bogus=1']) {
    const result = await request(`/api/projects/${p.id}/board${query}`, { user: ctx.owner });
    assert.equal(result.response.status, 400, `${query} should be rejected`);
  }
  assert.equal((await request(`/api/projects/${p.id}/board`, { user: ctx.outsider })).response.status, 404);
  assert.equal((await request(`/api/projects/${p.id}/board`)).response.status, 401);
  assert.equal((await request('/api/projects/abc/board', { user: ctx.owner })).response.status, 404);
  assert.equal((await request('/api/projects/999999999/board', { user: ctx.owner })).response.status, 404);
});

test('moving a card to another column persists the status, logs activity, and bumps updated time', async () => {
  const p = await freshProject('Move status');
  const a = await createTask(p.id, ctx.owner, { title: 'A' });
  const before = await getTask(p.id, a.id);
  await new Promise((r) => setTimeout(r, 20));

  const moved = await moveTask(p.id, a.id, ctx.member, { status: 'in_progress', afterTaskId: null });
  assert.equal(moved.response.status, 200, moved.data?.error?.message);
  assert.equal(moved.data.task.status, 'in_progress');

  const after = await getTask(p.id, a.id);
  assert.equal(after.status, 'in_progress');
  assert.ok(new Date(after.updatedAt) > new Date(before.updatedAt));
  assert.deepEqual(titles(await board(p.id, ctx.owner), 'in_progress'), ['A']);
  assert.equal(column(await board(p.id, ctx.owner), 'todo').total, 0);

  const activity = await request(`/api/projects/${p.id}/tasks/${a.id}/activity`, { user: ctx.owner });
  const entry = activity.data.activity[0];
  assert.equal(entry.action, 'task.status_changed');
  assert.equal(entry.actorId, ctx.member.id);
  assert.deepEqual(entry.details.changes.status, { from: 'todo', to: 'in_progress' });
});

test('reordering inside a column changes order only: no activity entry and no updated-time change', async () => {
  const p = await freshProject('Move reorder');
  const [a, b, c, d] = [];
  for (const title of ['A', 'B', 'C', 'D']) (await createTask(p.id, ctx.owner, { title })) && 0;
  const list = column(await board(p.id, ctx.owner), 'todo').tasks;
  const [ta, tb, tc, td] = list;
  assert.deepEqual(list.map((t) => t.title), ['A', 'B', 'C', 'D']);

  const stamp = (await getTask(p.id, td.id)).updatedAt;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await moveTask(p.id, td.id, ctx.owner, { status: 'todo', afterTaskId: null })).response.status, 200);
  assert.deepEqual(titles(await board(p.id, ctx.owner), 'todo'), ['D', 'A', 'B', 'C']);
  assert.equal((await getTask(p.id, td.id)).updatedAt, stamp);

  assert.equal((await moveTask(p.id, ta.id, ctx.owner, { status: 'todo', afterTaskId: tc.id })).response.status, 200);
  assert.deepEqual(titles(await board(p.id, ctx.owner), 'todo'), ['D', 'B', 'C', 'A']);
  assert.equal((await moveTask(p.id, tb.id, ctx.owner, { status: 'todo', afterTaskId: ta.id })).response.status, 200);
  assert.deepEqual(titles(await board(p.id, ctx.owner), 'todo'), ['D', 'C', 'A', 'B']);

  const activity = await request(`/api/projects/${p.id}/tasks/${td.id}/activity`, { user: ctx.owner });
  assert.deepEqual(activity.data.activity.map((e) => e.action), ['task.created']);
  void [a, b, c, d];
});

test('dropping between two cards of another column places the card exactly there', async () => {
  const p = await freshProject('Move between');
  const x1 = await createTask(p.id, ctx.owner, { title: 'X1', status: 'in_review' });
  await createTask(p.id, ctx.owner, { title: 'X2', status: 'in_review' });
  const y = await createTask(p.id, ctx.owner, { title: 'Y', status: 'todo' });
  assert.equal((await moveTask(p.id, y.id, ctx.owner, { status: 'in_review', afterTaskId: x1.id })).response.status, 200);
  assert.deepEqual(titles(await board(p.id, ctx.owner), 'in_review'), ['X1', 'Y', 'X2']);
});

test('move validates its input and rejects stale or foreign references', async () => {
  const p = await freshProject('Move validation');
  const other = await freshProject('Other project');
  const a = await createTask(p.id, ctx.owner, { title: 'A', status: 'todo' });
  const b = await createTask(p.id, ctx.owner, { title: 'B', status: 'done' });
  const foreign = await createTask(other.id, ctx.owner, { title: 'Foreign', status: 'todo' });

  const bad = async (body) => (await moveTask(p.id, a.id, ctx.owner, body)).response.status;
  assert.equal(await bad({}), 400);
  assert.equal(await bad({ status: 'blocked' }), 400);
  assert.equal(await bad({ status: 'todo', extra: 1 }), 400);
  assert.equal(await bad({ status: 'todo', afterTaskId: 'abc' }), 400);
  assert.equal(await bad({ status: 'todo', afterTaskId: a.id }), 400);
  assert.equal(await bad({ status: 'todo', afterTaskId: b.id }), 409, 'reference is in a different column');
  assert.equal(await bad({ status: 'todo', afterTaskId: foreign.id }), 409, 'reference is in another project');
  assert.equal(await bad({ status: 'todo', afterTaskId: '999999999' }), 409);

  assert.equal((await moveTask(p.id, '999999999', ctx.owner, { status: 'todo' })).response.status, 404);
  assert.equal((await moveTask(p.id, foreign.id, ctx.owner, { status: 'todo' })).response.status, 404, 'task of another project');
  assert.equal((await moveTask(p.id, a.id, ctx.outsider, { status: 'done' })).response.status, 404);
  assert.equal((await request(`/api/projects/${p.id}/tasks/${a.id}/move`, { method: 'POST', body: { status: 'done' } })).response.status, 401);
  assert.equal((await request(`/api/projects/${p.id}/tasks/${a.id}/move`, { user: ctx.owner, method: 'POST', body: { status: 'done' }, sendCsrf: false })).response.status, 403);
  assert.equal((await getTask(p.id, a.id)).status, 'todo', 'rejected moves change nothing');
});

test('moves are refused in archived projects', async () => {
  const p = await freshProject('Move archived');
  const a = await createTask(p.id, ctx.owner, { title: 'A' });
  const archive = await request(`/api/workspaces/${ctx.workspaceId}/projects/${p.id}/archive`, { user: ctx.owner, method: 'POST' });
  assert.equal(archive.response.status, 200);
  const result = await moveTask(p.id, a.id, ctx.owner, { status: 'done' });
  assert.equal(result.response.status, 409);
  const data = await board(p.id, ctx.owner);
  assert.equal(data.archived, true);
  assert.equal(column(data, 'todo').total, 1);
});

test('new tasks and PATCH status changes land at the bottom of the destination column', async () => {
  const p = await freshProject('Bottom placement');
  const a = await createTask(p.id, ctx.owner, { title: 'A', status: 'done' });
  await createTask(p.id, ctx.owner, { title: 'B', status: 'done' });
  const c = await createTask(p.id, ctx.owner, { title: 'C', status: 'todo' });
  const patched = await request(`/api/projects/${p.id}/tasks/${c.id}`, { user: ctx.owner, method: 'PATCH', body: { status: 'done' } });
  assert.equal(patched.response.status, 200);
  assert.deepEqual(titles(await board(p.id, ctx.owner), 'done'), ['A', 'B', 'C']);
  void a;
});

test('repeated drops between the same neighbours stay correctly ordered (column renumbering)', async () => {
  const p = await freshProject('Rebalance');
  const first = await createTask(p.id, ctx.owner, { title: 'first', status: 'backlog' });
  await createTask(p.id, ctx.owner, { title: 'last', status: 'backlog' });
  const expected = [];
  for (let i = 1; i <= 45; i += 1) {
    const task = await createTask(p.id, ctx.owner, { title: `n${i}`, status: 'todo' });
    const moved = await moveTask(p.id, task.id, ctx.owner, { status: 'backlog', afterTaskId: first.id });
    assert.equal(moved.response.status, 200, moved.data?.error?.message);
    expected.unshift(`n${i}`);
  }
  assert.deepEqual(titles(await board(p.id, ctx.owner, '?limit=100'), 'backlog'), ['first', ...expected, 'last']);

  const positions = await pool.query(
    "SELECT position FROM tasks WHERE project_id = $1 AND status = 'backlog' ORDER BY position, id", [p.id],
  );
  for (let i = 1; i < positions.rowCount; i += 1) {
    assert.ok(positions.rows[i].position - positions.rows[i - 1].position >= 1e-6, 'neighbouring positions stay distinguishable');
  }
});

test('concurrent moves into one column are serialised: all succeed with distinct positions', async () => {
  const p = await freshProject('Concurrent moves');
  for (let i = 1; i <= 4; i += 1) await createTask(p.id, ctx.owner, { title: `B${i}`, status: 'backlog' });
  const movers = [];
  for (let i = 1; i <= 8; i += 1) movers.push(await createTask(p.id, ctx.owner, { title: `M${i}`, status: 'todo' }));
  const results = await Promise.all(movers.map((t) => moveTask(p.id, t.id, ctx.member, { status: 'backlog', afterTaskId: null })));
  assert.deepEqual(results.map((r) => r.response.status), Array(8).fill(200));

  const data = await board(p.id, ctx.owner, '?limit=100');
  assert.equal(column(data, 'backlog').total, 12);
  assert.equal(column(data, 'todo').total, 0);
  const distinct = await pool.query(
    "SELECT COUNT(*)::INT AS total, COUNT(DISTINCT position)::INT AS distinct FROM tasks WHERE project_id = $1 AND status = 'backlog'", [p.id],
  );
  assert.equal(distinct.rows[0].total, distinct.rows[0].distinct);
  assert.deepEqual(titles(data, 'backlog').slice(8), ['B1', 'B2', 'B3', 'B4'], 'existing cards keep their order below the moved ones');
});

test('board and move respect workspace boundaries for a user of another workspace', async () => {
  const stranger = await createTestUser('stranger');
  await createWorkspace('other', [[stranger, 'owner']]);
  const p = await freshProject('Isolation');
  const a = await createTask(p.id, ctx.owner, { title: 'Secret' });
  assert.equal((await request(`/api/projects/${p.id}/board`, { user: stranger })).response.status, 404);
  assert.equal((await moveTask(p.id, a.id, stranger, { status: 'done' })).response.status, 404);
  assert.equal((await getTask(p.id, a.id)).status, 'todo');
});
