import assert from 'node:assert/strict';
import test from 'node:test';
import { afterIdOf, appendTasks, locate, moveCard, replaceCard, revertCard } from './boardState.js';

const card = (id, status = 'todo') => ({ id, title: `Task ${id}`, status });
const board = () => [
  { status: 'backlog', total: 1, tasks: [card('1', 'backlog')] },
  { status: 'todo', total: 3, tasks: [card('2'), card('3'), card('4')] },
  { status: 'done', total: 0, tasks: [] },
];
const ids = (columns, status) => columns.find((c) => c.status === status).tasks.map((t) => t.id);
const totals = (columns) => columns.map((c) => c.total);

test('locate and afterIdOf report position and the card above', () => {
  const b = board();
  assert.deepEqual(locate(b, '3'), { status: 'todo', index: 1 });
  assert.equal(locate(b, '99'), null);
  assert.equal(afterIdOf(b, '3'), '2');
  assert.equal(afterIdOf(b, '2'), null);
  assert.equal(afterIdOf(b, '99'), null);
});

test('moveCard across columns updates status, order, and both totals without mutating the input', () => {
  const b = board();
  const frozen = JSON.stringify(b);
  const next = moveCard(b, '3', 'backlog', '1');
  assert.deepEqual(ids(next, 'backlog'), ['1', '3']);
  assert.deepEqual(ids(next, 'todo'), ['2', '4']);
  assert.equal(next[0].tasks[1].status, 'backlog');
  assert.deepEqual(totals(next), [2, 2, 0]);
  assert.equal(JSON.stringify(b), frozen, 'input is untouched');
});

test('moveCard to the top, into an empty column, within a column, and with an unknown reference', () => {
  assert.deepEqual(ids(moveCard(board(), '4', 'todo', null), 'todo'), ['4', '2', '3']);
  const toEmpty = moveCard(board(), '2', 'done', null);
  assert.deepEqual(ids(toEmpty, 'done'), ['2']);
  assert.deepEqual(totals(toEmpty), [1, 2, 1]);
  const within = moveCard(board(), '2', 'todo', '4');
  assert.deepEqual(ids(within, 'todo'), ['3', '4', '2']);
  assert.deepEqual(totals(within), [1, 3, 0], 'totals unchanged for a reorder');
  assert.deepEqual(ids(moveCard(board(), '1', 'todo', 'missing'), 'todo'), ['2', '3', '4', '1']);
  const same = board();
  assert.equal(moveCard(same, 'missing', 'done', null), same, 'unknown card is a no-op');
});

test('revertCard restores the exact original order and totals after a cross-column move', () => {
  const original = board();
  const origin = { status: 'todo', afterId: afterIdOf(original, '3'), index: 1 };
  const moved = moveCard(original, '3', 'done', null);
  assert.deepEqual(revertCard(moved, '3', origin), original);
});

test('revertCard restores a card that was first in its column', () => {
  const original = board();
  const origin = { status: 'todo', afterId: null, index: 0 };
  assert.deepEqual(revertCard(moveCard(original, '2', 'backlog', '1'), '2', origin), original);
});

test('revertCard keeps unrelated changes made while the move was in flight', () => {
  const original = board();
  const origin = { status: 'todo', afterId: '2', index: 1 };
  let state = moveCard(original, '3', 'done', null);
  state = moveCard(state, '4', 'backlog', null); // a second, successful move
  const reverted = revertCard(state, '3', origin);
  assert.deepEqual(ids(reverted, 'todo'), ['2', '3']);
  assert.deepEqual(ids(reverted, 'backlog'), ['4', '1'], 'the other move is kept');
  assert.deepEqual(totals(reverted), [2, 2, 0]);
});

test('revertCard falls back to the old index (clamped) when the card it followed is gone', () => {
  const origin = { status: 'todo', afterId: 'gone', index: 7 };
  const state = moveCard(board(), '3', 'done', null);
  assert.deepEqual(ids(revertCard(state, '3', origin), 'todo'), ['2', '4', '3']);
});

test('replaceCard swaps in the server version in place; unknown ids are ignored', () => {
  const b = board();
  const next = replaceCard(b, { id: '3', title: 'Renamed', status: 'todo' });
  assert.equal(next[1].tasks[1].title, 'Renamed');
  assert.deepEqual(ids(next, 'todo'), ['2', '3', '4']);
  assert.equal(replaceCard(b, { id: '99', title: 'x', status: 'todo' }), b);
});

test('appendTasks adds new cards, skips duplicates, and records the server total', () => {
  const next = appendTasks(board(), 'todo', [card('4'), card('5'), card('6')], 6);
  assert.deepEqual(ids(next, 'todo'), ['2', '3', '4', '5', '6']);
  assert.equal(next[1].total, 6);
  assert.equal(next[0].tasks.length, 1, 'other columns untouched');
});
