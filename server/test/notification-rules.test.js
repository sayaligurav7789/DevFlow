// Pure rules for task notifications: who is told what. No database needed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskNotifications, clip, MESSAGE_LIMIT } from '../src/services/notificationRules.js';

const actor = { id: '1', displayName: 'Alice' };
const base = { actor, workspaceId: '7', projectId: '70', task: { id: '700', title: 'Ship it' } };
const build = (extra) => buildTaskNotifications({ ...base, ...extra });
const forUser = (rows, id) => rows.filter((r) => r.userId === id);

test('assigning a task notifies the new assignee', () => {
  const rows = build({ after: { assigneeId: '2', reporterId: '1' }, changes: { assigneeId: { from: null, to: '2' } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, '2');
  assert.equal(rows[0].type, 'task.assigned');
  assert.equal(rows[0].message, 'Alice assigned you "Ship it"');
  assert.equal(rows[0].workspaceId, '7');
  assert.equal(rows[0].entityType, 'task');
  assert.equal(rows[0].entityId, '700');
  assert.equal(rows[0].data.title, 'Ship it');
});

test('reassigning notifies both the new assignee and the previous one', () => {
  const rows = build({ after: { assigneeId: '3', reporterId: '1' }, changes: { assigneeId: { from: '2', to: '3' } } });
  assert.equal(rows.length, 2);
  const [toNew] = forUser(rows, '3');
  const [toOld] = forUser(rows, '2');
  assert.equal(toNew.type, 'task.assigned');
  assert.equal(toNew.message, 'Alice reassigned "Ship it" to you');
  assert.equal(toOld.type, 'task.reassigned');
  assert.match(toOld.message, /was reassigned from you by Alice/);
});

test('unassigning notifies the previous assignee only', () => {
  const rows = build({ after: { assigneeId: null, reporterId: '1' }, changes: { assigneeId: { from: '2', to: null } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, '2');
  assert.equal(rows[0].type, 'task.reassigned');
  assert.equal(rows[0].message, 'Alice unassigned you from "Ship it"');
});

test('the person making the change is never notified about it', () => {
  assert.deepEqual(build({ after: { assigneeId: '1', reporterId: '1' }, changes: { assigneeId: { from: null, to: '1' } } }), []);
  const rows = build({ after: { assigneeId: '1', reporterId: '1' }, changes: { status: { from: 'todo', to: 'done' } } });
  assert.deepEqual(rows, []);
});

test('important updates (status, priority, due date) notify the assignee and the reporter', () => {
  const rows = build({
    after: { assigneeId: '2', reporterId: '3' },
    changes: { status: { from: 'todo', to: 'in_progress' }, priority: { from: 'low', to: 'urgent' } },
  });
  assert.deepEqual(rows.map((r) => r.userId).sort(), ['2', '3']);
  for (const row of rows) {
    assert.equal(row.type, 'task.updated');
    assert.match(row.message, /status todo → in progress, priority low → urgent/);
    assert.deepEqual(Object.keys(row.data.changes).sort(), ['priority', 'status']);
  }
});

test('due date changes are described with dates, and clearing one says "none"', () => {
  const rows = build({
    after: { assigneeId: '2', reporterId: '1' },
    changes: { dueAt: { from: '2026-10-25T00:00:00.000Z', to: null } },
  });
  assert.equal(rows[0].message, 'Alice updated "Ship it": due date 2026-10-25 → none');
});

test('unimportant edits (title, description, labels, reporter) notify nobody', () => {
  const rows = build({
    after: { assigneeId: '2', reporterId: '3' },
    changes: { title: { from: 'a', to: 'b' }, description: { from: '', to: 'x' }, labels: { from: [], to: ['x'] } },
  });
  assert.deepEqual(rows, []);
});

test('a user who is assigned and is also the reporter gets a single notification', () => {
  const rows = build({
    after: { assigneeId: '2', reporterId: '2' },
    changes: { assigneeId: { from: null, to: '2' }, status: { from: 'todo', to: 'done' } },
  });
  assert.equal(rows.length, 1, 'assignment notification already tells them');
  assert.equal(rows[0].type, 'task.assigned');
});

test('a reporter is not told twice when they were also the previous assignee', () => {
  const rows = build({
    after: { assigneeId: '3', reporterId: '2' },
    changes: { assigneeId: { from: '2', to: '3' }, priority: { from: 'low', to: 'high' } },
  });
  assert.equal(forUser(rows, '2').length, 1);
  assert.equal(forUser(rows, '2')[0].type, 'task.reassigned');
});

test('deleting a task notifies assignee and reporter once each, never the actor', () => {
  const rows = build({ deleted: true, after: { assigneeId: '2', reporterId: '2' } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'task.deleted');
  assert.equal(rows[0].message, 'Alice deleted "Ship it"');
  assert.deepEqual(build({ deleted: true, after: { assigneeId: '1', reporterId: null } }), []);
});

test('an unassigned task with no relevant people produces no notifications', () => {
  assert.deepEqual(build({ after: { assigneeId: null, reporterId: null }, changes: { status: { from: 'todo', to: 'done' } } }), []);
});

test('numeric ids are normalised to strings so comparisons with the actor are reliable', () => {
  const rows = buildTaskNotifications({
    ...base,
    actor: { id: 1, displayName: 'Alice' },
    after: { assigneeId: 1, reporterId: 2 },
    changes: { status: { from: 'todo', to: 'done' } },
  });
  assert.deepEqual(rows.map((r) => r.userId), ['2']);
});

test('very long titles are clipped to the stored message limit', () => {
  const rows = build({
    task: { id: '700', title: 'x'.repeat(2000) },
    after: { assigneeId: '2', reporterId: '1' },
    changes: { assigneeId: { from: null, to: '2' } },
  });
  assert.ok(rows[0].message.length <= MESSAGE_LIMIT);
  assert.equal(clip('short'), 'short');
});
