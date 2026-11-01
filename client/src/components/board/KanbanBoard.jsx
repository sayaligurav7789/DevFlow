import { useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, closestCorners, pointerWithin, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { afterIdOf, locate } from '../../lib/boardState.js';
import { statusMeta } from '../../lib/constants.js';
import { BoardColumn } from './BoardColumn.jsx';
import { OverlayCard } from './TaskCard.jsx';

const COLUMN_PREFIX = 'column:';

// Where a dragged card lands relative to the card it is over: below the target's midpoint means
// "after it", otherwise "after the card above it". The dragged card's centre is used (not its top
// edge), so the result matches where the pointer is regardless of where the card was grabbed.
function placeAfter(column, overId, movedRect, overRect) {
  const index = column.tasks.findIndex((t) => t.id === overId);
  const below = movedRect && movedRect.top + movedRect.height / 2 > overRect.top + overRect.height / 2;
  return below ? overId : (index > 0 ? column.tasks[index - 1].id : null);
}

export function KanbanBoard({ board, readOnly, filtered, onOpen, onAdd }) {
  const [activeId, setActiveId] = useState(null);
  const origin = useRef(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    // Space picks up, arrows move, Space drops, Esc cancels. Enter is left free to open the task.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );

  const columns = board.columns;

  // Pointer on a card -> that card. Pointer in a column but between/below cards -> the nearest card of
  // that column (so gaps never fling the card to the bottom). Empty column -> the column itself.
  // Keyboard dragging has no pointer, so it uses closest corners.
  function collisionDetection(args) {
    const hits = pointerWithin(args);
    if (hits.length === 0) return closestCorners(args);
    const card = hits.find((hit) => !String(hit.id).startsWith(COLUMN_PREFIX));
    if (card) return [card];
    const status = String(hits[0].id).slice(COLUMN_PREFIX.length);
    const ids = new Set((board.getColumns().find((c) => c.status === status)?.tasks ?? []).map((t) => t.id));
    const nearest = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.has(String(c.id))) });
    return nearest.length ? [nearest[0]] : hits;
  }
  const find = (id) => columns.flatMap((c) => c.tasks).find((t) => t.id === id);
  const activeTask = activeId ? find(activeId) : null;
  const columnOf = (id) => {
    const s = String(id);
    if (s.startsWith(COLUMN_PREFIX)) return s.slice(COLUMN_PREFIX.length);
    return locate(board.getColumns(), s)?.status ?? null;
  };

  function onDragStart({ active }) {
    const id = String(active.id);
    const current = board.getColumns();
    const where = locate(current, id);
    origin.current = { status: where.status, index: where.index, afterId: afterIdOf(current, id) };
    setActiveId(id);
  }

  // Live preview while crossing into another column; nothing is sent to the server yet.
  function onDragOver({ active, over }) {
    if (!over) return;
    const id = String(active.id);
    const current = board.getColumns();
    const from = locate(current, id);
    const targetStatus = columnOf(over.id);
    if (!from || !targetStatus || targetStatus === from.status) return;
    const target = current.find((c) => c.status === targetStatus);
    let afterId = target.tasks.at(-1)?.id ?? null;
    if (!String(over.id).startsWith(COLUMN_PREFIX)) {
      afterId = placeAfter(target, String(over.id), active.rect.current.translated, over.rect);
    }
    board.previewMove(id, targetStatus, afterId);
  }

  function onDragEnd({ active, over }) {
    const id = String(active.id);
    setActiveId(null);
    if (!over) { board.revertLocal(id, origin.current); return; }
    const current = board.getColumns();
    const where = locate(current, id);
    const overId = String(over.id);
    if (where) {
      const column = current.find((c) => c.status === where.status);
      if (overId.startsWith(COLUMN_PREFIX)) {
        // Dropped on empty space inside the column the card is already in: send it to the bottom.
        if (overId === `${COLUMN_PREFIX}${where.status}`) {
          const last = column.tasks.filter((t) => t.id !== id).at(-1)?.id ?? null;
          board.previewMove(id, where.status, last);
        }
      } else if (overId !== id) {
        const overWhere = locate(current, overId);
        if (overWhere && overWhere.status === where.status) {
          const afterId = placeAfter(column, overId, active.rect.current.translated, over.rect);
          // afterId === id means "stay directly under the card I already follow": nothing to change.
          if (afterId !== id && afterId !== afterIdOf(current, id)) board.previewMove(id, where.status, afterId);
        }
      }
    }
    board.commitMove(id, origin.current);
  }

  function onDragCancel({ active }) {
    setActiveId(null);
    board.revertLocal(String(active.id), origin.current);
  }

  const labelOf = (id) => {
    const status = columnOf(id);
    return status ? statusMeta(status).label : 'the board';
  };
  const titleOf = (id) => find(String(id))?.title ?? 'task';
  const accessibility = {
    screenReaderInstructions: { draggable: 'Press space to pick up this task. Use the arrow keys to move it between columns and up or down. Press space to drop it, or escape to cancel. Press enter to open the task.' },
    announcements: {
      onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${labelOf(over.id)}.` : `${titleOf(active.id)} is not over a column.`),
      onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(active.id)} in ${labelOf(over.id)}.` : `${titleOf(active.id)} was dropped outside the board and returned.`),
      onDragCancel: ({ active }) => `Move cancelled. ${titleOf(active.id)} returned to ${statusMeta(origin.current?.status).label}.`,
    },
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={accessibility}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" role="group" aria-label="Kanban board">
        {columns.map((column) => (
          <BoardColumn
            key={column.status}
            column={column}
            readOnly={readOnly}
            filtered={filtered}
            pending={board.pending}
            loadingMore={Boolean(board.loadingMore[column.status])}
            onOpen={onOpen}
            onMove={board.moveToColumn}
            onAdd={onAdd}
            onLoadMore={board.loadMore}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160 }}>{activeTask ? <OverlayCard task={activeTask} /> : null}</DragOverlay>
    </DndContext>
  );
}
