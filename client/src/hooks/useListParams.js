import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// URL-backed list state (search, filters, sort, page). Back/forward and shared links keep
// their state. Changing anything but `page` resets to page 1.
export function useListParams(defaults) {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const out = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      const raw = params.get(key);
      if (Array.isArray(fallback)) out[key] = raw ? raw.split(',').filter(Boolean) : fallback;
      else if (typeof fallback === 'number') out[key] = Number.parseInt(raw ?? '', 10) > 0 ? Number.parseInt(raw, 10) : fallback;
      else out[key] = raw ?? fallback;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const set = useCallback((changes) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        const fallback = defaults[key];
        const isDefault = Array.isArray(value)
          ? value.join(',') === (fallback ?? []).join(',')
          : value === fallback || value === '' || value == null;
        if (isDefault) next.delete(key);
        else next.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
      if (!('page' in changes)) next.delete('page');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setParams]);

  // Drops every filter and the page but keeps the chosen sort order.
  const clear = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams();
      for (const key of ['sortBy', 'sortOrder']) if (current.has(key)) next.set(key, current.get(key));
      return next;
    }, { replace: true });
  }, [setParams]);

  const activeFilterCount = useMemo(
    () => Object.keys(defaults).filter((key) => !['page', 'sortBy', 'sortOrder'].includes(key)
      && JSON.stringify(values[key]) !== JSON.stringify(defaults[key])).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values],
  );
  return { values, set, clear, activeFilterCount };
}
