import { useCallback, useEffect, useRef, useState } from 'react';

// Runs `fetcher(signal)` whenever `deps` change. Keeps previous data visible while refetching
// (`refreshing`), ignores stale responses, and aborts on unmount.
export function useFetch(fetcher, deps, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef
      .current(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  // Until the first response (or error) arrives we are loading, even on the render before the effect runs.
  const loading = state.loading || (enabled && state.data === null && state.error === null);
  return { ...state, loading, reload, refreshing: loading && state.data !== null };
}
