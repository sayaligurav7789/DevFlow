import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

// Controlled-by-URL search box with local state so typing never lags; debounces upstream updates.
export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search', delay = 300, className = '' }) {
  const [local, setLocal] = useState(value);
  const lastSent = useRef(value);

  useEffect(() => {
    if (value !== lastSent.current) { setLocal(value); lastSent.current = value; }
  }, [value]);

  useEffect(() => {
    if (local === lastSent.current) return undefined;
    const id = setTimeout(() => { lastSent.current = local; onChange(local.trim()); }, delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className={`relative ${className}`}>
      <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
      <input
        type="search"
        aria-label={label}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        maxLength={150}
        className="h-8 w-full rounded-md border border-line-strong bg-panel pl-8 pr-2.5 text-[13px] placeholder:text-faint hover:border-faint [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  );
}
