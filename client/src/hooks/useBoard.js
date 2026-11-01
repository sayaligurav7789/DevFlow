import { useCallback, useEffect, useRef, useState } from 'react';
import { projectApi, taskApi } from '../lib/endpoints.js';
import { afterIdOf, appendTasks, locate, moveCard, replaceCard, revertCard } from '../lib/boardState.js';

export const BOARD_PAGE_SIZE = 25;

// Owns the board's columns. Moves are optimistic: the card changes place immediately, the request
// goes through a queue (one at a time, in drop order), and a failed request puts that one card back
// without touching anything else. The columns live in a ref so drag handlers always read fresh state.
export function useBoard({ projectId, filters, refreshKey, onMoveError }) {
  const [view, setView] = useState({ columns: null, archived: false, loading: true, error: null });
  const [pending, setPending] = useState(() => new Set());
  const [loadingMore, setLoadingMore] = useState({});
  const columnsRef = useRef(null);
  const queueRef = useRef(Promise.resolve());
  const requestRef = useRef(0);
  const onMoveErrorRef = useRef(onMoveError);
  onMoveErrorRef.current = onMoveError;
  const filterKey = JSON.stringify(filters);

  const update = useCallback((change) => {
    const next = change(columnsRef.current);
    if (next === columnsRef.current) return;
    columnsRef.current = next;
    setView((v) => ({ ...v, columns: next }));
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++requestRef.current;
    if (!silent) setView((v) => ({ ...v, loading: true, error: null }));
    try {
      await queueRef.current.catch(() => {}); // let in-flight moves land before reading the board
      const data = await projectApi.board(projectId, { ...filters, limit: BOARD_PAGE_SIZE });
      if (id !== requestRef.current) return;
      columnsRef.current = data.columns;
      setView({ columns: data.columns, archived: data.archived, loading: false, error: null });
    } catch (error) {
      if (id !== requestRef.current) return;
      setView((v) => ({ ...v, loading: false, error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filterKey]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const getColumns = useCallback(() => columnsRef.current, []);
  const previewMove = useCallback((taskId, status, afterId) => update((c) => moveCard(c, taskId, status, afterId)), [update]);
  const revertLocal = useCallback((taskId, origin) => update((c) => revertCard(c, taskId, origin)), [update]);

  // Sends the card's current place (already shown on screen) to the server.
  const commitMove = useCallback((taskId, origin) => {
    const columns = columnsRef.current;
    const where = locate(columns, taskId);
    if (!where) return Promise.resolve();
    const afterId = afterIdOf(columns, taskId);
    if (where.status === origin.status && afterId === origin.afterId) return Promise.resolve(); // dropped where it started
    setPending((p) => new Set(p).add(taskId));
    const run = async () => {
      try {
        const { task } = await taskApi.move(projectId, taskId, { status: where.status, afterTaskId: afterId });
        update((c) => replaceCard(c, task));
      } catch (error) {
        update((c) => revertCard(c, taskId, origin));
        onMoveErrorRef.current?.(error, taskId);
        // The card we dropped after (or the task itself) changed under us: re-read the real board.
        if (error.status === 409 || error.status === 404) load({ silent: true });
      } finally {
        setPending((p) => { const n = new Set(p); n.delete(taskId); return n; });
      }
    };
    queueRef.current = queueRef.current.then(run, run);
    return queueRef.current;
  }, [projectId, update, load]);

  // Non-drag way to move a card (menu / keyboard users): place it at the bottom of another column.
  const moveToColumn = useCallback((taskId, status) => {
    const columns = columnsRef.current;
    const where = locate(columns, taskId);
    if (!where || where.status === status) return Promise.resolve();
    const origin = { status: where.status, index: where.index, afterId: afterIdOf(columns, taskId) };
    const target = columns.find((column) => column.status === status);
    update((c) => moveCard(c, taskId, status, target.tasks.at(-1)?.id ?? null));
    return commitMove(taskId, origin);
  }, [commitMove, update]);

  const loadMore = useCallback(async (status) => {
    const column = columnsRef.current?.find((c) => c.status === status);
    if (!column || loadingMore[status]) return;
    setLoadingMore((s) => ({ ...s, [status]: true }));
    try {
      const page = Math.floor(column.tasks.length / BOARD_PAGE_SIZE) + 1;
      const data = await taskApi.list(projectId, { ...filters, status, sortBy: 'position', sortOrder: 'asc', limit: BOARD_PAGE_SIZE, page });
      update((c) => appendTasks(c, status, data.tasks, data.pagination.total));
    } catch (error) {
      onMoveErrorRef.current?.(error);
    } finally {
      setLoadingMore((s) => ({ ...s, [status]: false }));
    }
  }, [projectId, filters, loadingMore, update]);

  return { ...view, pending, loadingMore, getColumns, previewMove, revertLocal, commitMove, moveToColumn, loadMore, reload: load };
}
