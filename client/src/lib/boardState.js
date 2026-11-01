// Pure board-state helpers. `columns` is [{ status, total, tasks: [...] }] in board order.
// Every function returns new objects and never mutates its input, so React state stays safe
// and an optimistic move can always be undone by applying the inverse move.

const cloneColumns = (columns) => columns.map((column) => ({ ...column, tasks: [...column.tasks] }));

export function locate(columns, taskId) {
  for (const column of columns) {
    const index = column.tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) return { status: column.status, index };
  }
  return null;
}

// The card directly above `taskId` in its column (null when it is first). This is what the API
// calls `afterTaskId`.
export function afterIdOf(columns, taskId) {
  const where = locate(columns, taskId);
  if (!where || where.index === 0) return null;
  return columns.find((column) => column.status === where.status).tasks[where.index - 1].id;
}

function insertIndex(destination, afterId, fallback) {
  if (afterId === null) return 0;
  const at = destination.tasks.findIndex((task) => task.id === afterId);
  return at >= 0 ? at + 1 : fallback;
}

// Moves a card into `toStatus` directly after `afterId` (null = top). An unknown afterId puts it at the bottom.
export function moveCard(columns, taskId, toStatus, afterId) {
  const from = locate(columns, taskId);
  if (!from) return columns;
  const next = cloneColumns(columns);
  const source = next.find((column) => column.status === from.status);
  const destination = next.find((column) => column.status === toStatus);
  if (!destination) return columns;
  const [card] = source.tasks.splice(from.index, 1);
  destination.tasks.splice(insertIndex(destination, afterId, destination.tasks.length), 0, { ...card, status: toStatus });
  if (from.status !== toStatus) {
    source.total = Math.max(0, source.total - 1);
    destination.total += 1;
  }
  return next;
}

// Undoes a move: puts the card back where it was when the drag started (`origin` = { status, afterId, index }).
// If the card it used to follow has since disappeared, it falls back to the old index, clamped to the column.
export function revertCard(columns, taskId, origin) {
  const from = locate(columns, taskId);
  if (!from) return columns;
  const next = cloneColumns(columns);
  const source = next.find((column) => column.status === from.status);
  const destination = next.find((column) => column.status === origin.status);
  const [card] = source.tasks.splice(from.index, 1);
  const at = origin.afterId === null
    ? 0
    : insertIndex(destination, origin.afterId, Math.min(origin.index, destination.tasks.length));
  destination.tasks.splice(at, 0, { ...card, status: origin.status });
  if (from.status !== origin.status) {
    source.total = Math.max(0, source.total - 1);
    destination.total += 1;
  }
  return next;
}

// Swaps in the server's version of a card (same place) after a successful move.
export function replaceCard(columns, task) {
  const where = locate(columns, task.id);
  if (!where) return columns;
  return columns.map((column) => (column.status === where.status
    ? { ...column, tasks: column.tasks.map((existing) => (existing.id === task.id ? task : existing)) }
    : column));
}

// Appends a loaded page to a column, skipping cards already shown, and records the server total.
export function appendTasks(columns, status, tasks, total) {
  return columns.map((column) => {
    if (column.status !== status) return column;
    const known = new Set(column.tasks.map((task) => task.id));
    return { ...column, total, tasks: [...column.tasks, ...tasks.filter((task) => !known.has(task.id))] };
  });
}
