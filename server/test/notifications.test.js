// Persistent notifications through the real HTTP stack and PostgreSQL: assignment, reassignment,
// important updates, invitations, deadlines, unread counts, mark-as-read, history, isolation and
// persistence when Redis is down. Requires PostgreSQL (DEVFLOW_DB_NAME must end in _test).
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  createProject, createTask, createTestUser, createWorkspace, ctx, day, moveTask, pool, request, runId, setupHarness,
} from '../test-support/stage7.js';
import { FakeRedis } from '../test-support/fakeRedis.js';

const redisLib = await import('../src/lib/redis.js');
const { generateDeadlineNotifications } = await import('../src/services/deadlineNotifications.service.js');
const fake = new FakeRedis();

setupHarness(async () => {
  redisLib.setRedisClientForTests(fake);
});
after(() => redisLib.setRedisClientForTests(null));

const list = (user, query = '') => request(`/api/notifications${query}`, { user });
const unread = async (user, query = '') => {
  const result = await request(`/api/notifications/unread-count${query}`, { user });
  assert.equal(result.response.status, 200, result.data?.error?.message);
  return result.data.unreadCount;
};
const rows = (userId, where = '', values = []) => pool.query(
  `SELECT id::TEXT AS id, type, message, workspace_id::TEXT AS "workspaceId", entity_id::TEXT AS "entityId",
          read_at AS "readAt", data
   FROM notifications WHERE user_id = $1 ${where} ORDER BY id`,
  [userId, ...values],
).then((r) => r.rows);

async function freshWorkspace(label, roles = {}) {
  const owner = await createTestUser(`${label}-owner`);
  const member = await createTestUser(`${label}-member`);
  const other = await createTestUser(`${label}-other`);
  const memberships = [[owner, 'owner'], [member, 'member'], [other, 'member']];
  const workspaceId = await createWorkspace(label, memberships);
  const project = await createProject(workspaceId, owner, `${label} project`);
  return { owner, member, other, workspaceId, project, ...roles };
}

test('requires authentication', async () => {
  assert.equal((await list(undefined)).response.status, 401);
  assert.equal((await request('/api/notifications/unread-count', {})).response.status, 401);
  assert.equal((await request('/api/notifications/read-all', { method: 'POST', body: {} })).response.status, 401);
});

test('assigning a task on creation persists a notification for the assignee only', async () => {
  const w = await freshWorkspace('assign');
  const task = await createTask(w.project.id, w.owner, { title: 'Write docs', assigneeId: w.member.id });

  const stored = await rows(w.member.id);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].type, 'task.assigned');
  assert.equal(stored[0].workspaceId, w.workspaceId);
  assert.equal(stored[0].entityId, task.id);
  assert.equal(stored[0].readAt, null);
  assert.match(stored[0].message, /assigned you "Write docs"/);

  assert.equal((await rows(w.owner.id)).length, 0, 'the actor is not notified of their own action');
  assert.equal((await rows(w.other.id)).length, 0);

  const api = await list(w.member);
  assert.equal(api.response.status, 200);
  assert.equal(api.data.unreadCount, 1);
  assert.equal(api.data.notifications[0].read, false);
  assert.equal(api.data.notifications[0].actorName, w.owner.displayName);
  assert.equal(await unread(w.member), 1);
});

test('self-assignment creates no notification', async () => {
  const w = await freshWorkspace('self');
  await createTask(w.project.id, w.owner, { title: 'Mine', assigneeId: w.owner.id });
  assert.equal((await rows(w.owner.id)).length, 0);
});

test('reassignment notifies the new assignee and the previous assignee', async () => {
  const w = await freshWorkspace('reassign');
  const task = await createTask(w.project.id, w.owner, { title: 'Hand over', assigneeId: w.member.id });
  const patched = await request(`/api/projects/${w.project.id}/tasks/${task.id}`, {
    user: w.owner, method: 'PATCH', body: { assigneeId: w.other.id },
  });
  assert.equal(patched.response.status, 200);

  const toOther = await rows(w.other.id);
  assert.equal(toOther.length, 1);
  assert.equal(toOther[0].type, 'task.assigned');
  assert.match(toOther[0].message, /reassigned "Hand over" to you/);

  const toMember = await rows(w.member.id, "AND type = 'task.reassigned'");
  assert.equal(toMember.length, 1);
  assert.match(toMember[0].message, /was reassigned from you/);
});

test('important updates notify assignee and reporter; the actor and unimportant edits do not', async () => {
  const w = await freshWorkspace('updates');
  // Reporter defaults to the creator (owner); assignee is `member`.
  const task = await createTask(w.project.id, w.owner, { title: 'Watch me', assigneeId: w.member.id, status: 'todo' });
  const base = (await rows(w.owner.id)).length;

  // Member moves the card: the reporter (owner) is told, the actor (member) is not.
  const moved = await moveTask(w.project.id, task.id, w.member, { status: 'in_progress', afterTaskId: null });
  assert.equal(moved.response.status, 200);
  const ownerRows = await rows(w.owner.id);
  assert.equal(ownerRows.length, base + 1);
  assert.equal(ownerRows.at(-1).type, 'task.updated');
  assert.match(ownerRows.at(-1).message, /status todo → in progress/);
  assert.equal((await rows(w.member.id, "AND type = 'task.updated'")).length, 0);

  // Owner raises priority and sets a due date: assignee is told once, with both changes.
  const patched = await request(`/api/projects/${w.project.id}/tasks/${task.id}`, {
    user: w.owner, method: 'PATCH', body: { priority: 'urgent', dueAt: day(5) },
  });
  assert.equal(patched.response.status, 200);
  const memberUpdates = await rows(w.member.id, "AND type = 'task.updated'");
  assert.equal(memberUpdates.length, 1);
  assert.match(memberUpdates[0].message, /priority medium → urgent/);
  assert.match(memberUpdates[0].message, /due date none →/);

  // A title edit is not "important".
  const before = (await rows(w.member.id)).length;
  await request(`/api/projects/${w.project.id}/tasks/${task.id}`, { user: w.owner, method: 'PATCH', body: { title: 'Renamed' } });
  assert.equal((await rows(w.member.id)).length, before);
});

test('deleting a task notifies its assignee', async () => {
  const w = await freshWorkspace('delete');
  const task = await createTask(w.project.id, w.owner, { title: 'Doomed', assigneeId: w.member.id });
  const deleted = await request(`/api/projects/${w.project.id}/tasks/${task.id}`, { user: w.owner, method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  const stored = await rows(w.member.id, "AND type = 'task.deleted'");
  assert.equal(stored.length, 1);
  assert.match(stored[0].message, /deleted "Doomed"/);
});

test('a failed change persists no notification (same transaction)', async () => {
  const w = await freshWorkspace('rollback');
  const outsider = ctx.outsider;
  const rejected = await request(`/api/projects/${w.project.id}/tasks`, {
    user: w.owner, method: 'POST', body: { title: 'Bad assignee', assigneeId: outsider.id },
  });
  assert.equal(rejected.response.status, 400);
  assert.equal((await rows(outsider.id)).length, 0);
});

test('history is newest-first, paginated, and filterable by unread and workspace', async () => {
  const w = await freshWorkspace('history');
  for (const title of ['one', 'two', 'three']) {
    await createTask(w.project.id, w.owner, { title, assigneeId: w.member.id });
  }
  const page1 = await list(w.member, '?limit=2&page=1');
  assert.equal(page1.response.status, 200);
  assert.equal(page1.data.notifications.length, 2);
  assert.deepEqual(page1.data.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
  assert.match(page1.data.notifications[0].message, /"three"/);
  assert.match(page1.data.notifications[1].message, /"two"/);
  const page2 = await list(w.member, '?limit=2&page=2');
  assert.equal(page2.data.notifications.length, 1);
  assert.match(page2.data.notifications[0].message, /"one"/);

  const first = page1.data.notifications[0];
  const read = await request(`/api/notifications/${first.id}/read`, { user: w.member, method: 'POST' });
  assert.equal(read.response.status, 200);
  const onlyUnread = await list(w.member, '?unread=true');
  assert.equal(onlyUnread.data.notifications.length, 2);
  assert.equal(onlyUnread.data.unreadCount, 2);
  const everything = await list(w.member);
  assert.equal(everything.data.pagination.total, 3, 'read notifications stay in the history');

  const scoped = await list(w.member, `?workspaceId=${w.workspaceId}`);
  assert.equal(scoped.data.pagination.total, 3);
  const otherWorkspace = await list(w.member, `?workspaceId=${ctx.workspaceId}`);
  assert.equal(otherWorkspace.data.pagination.total, 0);
});

test('mark-as-read is idempotent and updates the unread count', async () => {
  const w = await freshWorkspace('markread');
  await createTask(w.project.id, w.owner, { title: 'a', assigneeId: w.member.id });
  await createTask(w.project.id, w.owner, { title: 'b', assigneeId: w.member.id });
  assert.equal(await unread(w.member), 2);
  const [target] = (await list(w.member)).data.notifications;

  const first = await request(`/api/notifications/${target.id}/read`, { user: w.member, method: 'POST' });
  assert.equal(first.response.status, 200);
  assert.equal(first.data.notification.read, true);
  assert.ok(first.data.notification.readAt);
  assert.equal(await unread(w.member), 1);

  const again = await request(`/api/notifications/${target.id}/read`, { user: w.member, method: 'POST' });
  assert.equal(again.response.status, 200);
  assert.equal(again.data.notification.readAt, first.data.notification.readAt, 'readAt is not rewritten');
  assert.equal(await unread(w.member), 1);
});

test('read-all clears everything, or only one workspace when scoped', async () => {
  const w1 = await freshWorkspace('readall1');
  const w2 = await freshWorkspace('readall2');
  // Same person is a member of both workspaces.
  await pool.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [w2.workspaceId, w1.member.id, 'member']);
  await createTask(w1.project.id, w1.owner, { title: 'in-1', assigneeId: w1.member.id });
  await createTask(w2.project.id, w2.owner, { title: 'in-2', assigneeId: w1.member.id });
  assert.equal(await unread(w1.member), 2);
  assert.equal(await unread(w1.member, `?workspaceId=${w1.workspaceId}`), 1);

  const scoped = await request('/api/notifications/read-all', { user: w1.member, method: 'POST', body: { workspaceId: w1.workspaceId } });
  assert.equal(scoped.response.status, 200);
  assert.equal(scoped.data.updated, 1);
  assert.equal(await unread(w1.member), 1, 'the other workspace is untouched');

  const all = await request('/api/notifications/read-all', { user: w1.member, method: 'POST', body: {} });
  assert.equal(all.data.updated, 1);
  assert.equal(await unread(w1.member), 0);
});

test('notifications are private: others cannot read, count, or mark them', async () => {
  const w = await freshWorkspace('privacy');
  await createTask(w.project.id, w.owner, { title: 'secret title', assigneeId: w.member.id });
  const [mine] = (await list(w.member)).data.notifications;

  const ownerList = await list(w.owner);
  assert.ok(!JSON.stringify(ownerList.data).includes('secret title'));
  assert.equal(ownerList.data.pagination.total, 0);

  const outsiderList = await list(ctx.outsider);
  assert.equal(outsiderList.data.pagination.total, 0);

  const foreignMark = await request(`/api/notifications/${mine.id}/read`, { user: w.owner, method: 'POST' });
  assert.equal(foreignMark.response.status, 404, 'indistinguishable from a missing notification');
  assert.equal((await rows(w.member.id))[0].readAt, null, 'the owner must not have changed the member\'s notification');

  const foreignReadAll = await request('/api/notifications/read-all', { user: w.owner, method: 'POST', body: {} });
  assert.equal(foreignReadAll.data.updated, 0);
  assert.equal(await unread(w.member), 1);
});

test('input validation', async () => {
  const w = await freshWorkspace('validation');
  assert.equal((await request('/api/notifications/abc/read', { user: w.member, method: 'POST' })).response.status, 404);
  assert.equal((await request('/api/notifications/999999999999/read', { user: w.member, method: 'POST' })).response.status, 404);
  assert.equal((await list(w.member, '?bogus=1')).response.status, 400);
  assert.equal((await list(w.member, '?workspaceId=abc')).response.status, 400);
  assert.equal((await list(w.member, '?unread=maybe')).response.status, 400);
  assert.equal((await list(w.member, '?limit=1000')).response.status, 400);
  assert.equal((await list(w.member, '?page=0')).response.status, 400);
  assert.equal((await request('/api/notifications/read-all', { user: w.member, method: 'POST', body: { nope: 1 } })).response.status, 400);
});

test('notifications persist and stay readable while Redis is down', async () => {
  const w = await freshWorkspace('redisdown');
  fake.failing = true;
  redisLib.resetRedisBreakerForTests();
  try {
    await createTask(w.project.id, w.owner, { title: 'During outage', assigneeId: w.member.id });
    const api = await list(w.member);
    assert.equal(api.response.status, 200);
    assert.equal(api.data.unreadCount, 1);
    const [item] = api.data.notifications;
    const read = await request(`/api/notifications/${item.id}/read`, { user: w.member, method: 'POST' });
    assert.equal(read.response.status, 200);
    assert.equal(await unread(w.member), 0);
  } finally {
    fake.failing = false;
    redisLib.resetRedisBreakerForTests();
  }
  assert.equal((await rows(w.member.id)).length, 1, 'the row is in PostgreSQL');
});

test('invitations: an existing user is notified (without the token); accepting clears the badge', async () => {
  const w = await freshWorkspace('invite');
  const invitee = await createTestUser('invitee');
  const created = await request(`/api/workspaces/${w.workspaceId}/invitations`, {
    user: w.owner, method: 'POST', body: { email: invitee.email, role: 'member' },
  });
  assert.equal(created.response.status, 201, created.data?.error?.message);
  const token = new URL(created.data.developmentInvitationUrl, 'http://x').searchParams.get('token');

  const stored = await rows(invitee.id, "AND type = 'workspace.invitation'");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].workspaceId, w.workspaceId);
  assert.match(stored[0].message, /invited you to join/);
  assert.ok(!JSON.stringify(stored[0]).includes(token), 'the invitation token must never be stored in a notification');
  assert.equal(await unread(invitee), 1);

  const api = await list(invitee);
  assert.ok(!JSON.stringify(api.data).includes(token));
  assert.equal(api.data.notifications[0].type, 'workspace.invitation');

  const accepted = await request('/api/invitations/accept', { user: invitee, method: 'POST', body: { token } });
  assert.equal(accepted.response.status, 200, accepted.data?.error?.message);
  assert.equal(await unread(invitee), 0, 'handled invitation no longer counts as unread');
  assert.equal((await list(invitee)).data.pagination.total, 1, 'but it stays in the history');
});

test('invitations: revoking clears the invitee badge; inviting an unknown email creates nothing', async () => {
  const w = await freshWorkspace('revoke');
  const invitee = await createTestUser('revokee');
  const created = await request(`/api/workspaces/${w.workspaceId}/invitations`, {
    user: w.owner, method: 'POST', body: { email: invitee.email, role: 'member' },
  });
  assert.equal(created.response.status, 201);
  assert.equal(await unread(invitee), 1);
  const revoked = await request(`/api/workspaces/${w.workspaceId}/invitations/${created.data.invitation.id}`, { user: w.owner, method: 'DELETE' });
  assert.equal(revoked.response.status, 200);
  assert.equal(await unread(invitee), 0);

  const unknown = await request(`/api/workspaces/${w.workspaceId}/invitations`, {
    user: w.owner, method: 'POST', body: { email: `nobody-${runId}@example.test`, role: 'member' },
  });
  assert.equal(unknown.response.status, 201);
  const leaked = await pool.query(
    "SELECT COUNT(*)::INTEGER AS n FROM notifications WHERE type = 'workspace.invitation' AND workspace_id = $1",
    [w.workspaceId],
  );
  assert.equal(leaked.rows[0].n, 1, 'only the existing user (revoked above) ever got a notification');
});

test('removing a member deletes their notifications for that workspace only', async () => {
  const w1 = await freshWorkspace('remove1');
  const w2 = await freshWorkspace('remove2');
  await pool.query('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)', [w2.workspaceId, w1.member.id, 'member']);
  await createTask(w1.project.id, w1.owner, { title: 'gone', assigneeId: w1.member.id });
  await createTask(w2.project.id, w2.owner, { title: 'stays', assigneeId: w1.member.id });
  assert.equal((await rows(w1.member.id)).length, 2);

  const removed = await request(`/api/workspaces/${w1.workspaceId}/members/${w1.member.id}`, { user: w1.owner, method: 'DELETE' });
  assert.equal(removed.response.status, 200);

  const left = await rows(w1.member.id);
  assert.equal(left.length, 1);
  assert.equal(left[0].workspaceId, w2.workspaceId);
  assert.ok(!JSON.stringify((await list(w1.member)).data).includes('gone'));
});

test('deadline sweep: due-soon and overdue notifications go to the assignee once, and respect exclusions', async () => {
  const w = await freshWorkspace('deadline');
  const make = (title, fields) => createTask(w.project.id, w.owner, { title, assigneeId: w.member.id, ...fields });
  const soon = await make('due soon', { dueAt: day(1) });
  const overdue = await make('overdue', { dueAt: day(-2) });
  await make('far away', { dueAt: day(10) });
  await make('ancient', { dueAt: day(-30) });
  await make('already done', { dueAt: day(-2), status: 'done' });
  await createTask(w.project.id, w.owner, { title: 'unassigned', dueAt: day(1) });
  const archivedProject = await createProject(w.workspaceId, w.owner, 'archived one');
  await createTask(archivedProject.id, w.owner, { title: 'in archived', assigneeId: w.member.id, dueAt: day(1) });
  const archived = await request(`/api/workspaces/${w.workspaceId}/projects/${archivedProject.id}/archive`, { user: w.owner, method: 'POST' });
  assert.equal(archived.response.status, 200);

  const deadlineRows = () => rows(w.member.id, "AND type IN ('deadline.due_soon', 'deadline.overdue')");
  const first = await generateDeadlineNotifications();
  assert.ok(first.dueSoon >= 1 && first.overdue >= 1);

  const stored = await deadlineRows();
  const byTask = Object.fromEntries(stored.map((r) => [r.entityId, r]));
  assert.equal(stored.length, 2, 'exactly the due-soon and the overdue task');
  assert.equal(byTask[soon.id].type, 'deadline.due_soon');
  assert.match(byTask[soon.id].message, /"due soon" is due /);
  assert.equal(byTask[overdue.id].type, 'deadline.overdue');
  assert.match(byTask[overdue.id].message, /"overdue" is overdue/);
  assert.equal((await rows(w.owner.id, "AND type LIKE 'deadline.%'")).length, 0, 'only assignees are notified');

  // Idempotent: running again (or on another instance) creates nothing new.
  await generateDeadlineNotifications();
  await Promise.all([generateDeadlineNotifications(), generateDeadlineNotifications()]);
  assert.equal((await deadlineRows()).length, 2);

  // A changed due date is a new deadline event and is announced again.
  const moved = await request(`/api/projects/${w.project.id}/tasks/${soon.id}`, { user: w.owner, method: 'PATCH', body: { dueAt: day(0) } });
  assert.equal(moved.response.status, 200);
  await generateDeadlineNotifications();
  const after = await deadlineRows();
  assert.equal(after.length, 3);

  // Completing a task stops further notifications for it.
  await request(`/api/projects/${w.project.id}/tasks/${overdue.id}`, { user: w.owner, method: 'PATCH', body: { status: 'done', dueAt: day(-3) } });
  await generateDeadlineNotifications();
  assert.equal((await deadlineRows()).length, 3);
});
