import { useId } from 'react';

const CONTROL = 'block w-full rounded-md border bg-panel px-3 text-[13px] text-fg placeholder:text-faint transition-colors disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted';
const border = (invalid) => (invalid ? 'border-danger' : 'border-line-strong hover:border-faint focus:border-accent');

// Label + control + hint/error wired together with ids so screen readers announce them.
export function Field({ label, hint, error, optional, children, className = '' }) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between text-[12.5px] font-medium text-fg">
        <span>{label}</span>
        {optional && <span className="text-[11.5px] font-normal text-faint">Optional</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, invalid: Boolean(error) })}
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-faint">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function Input({ invalid, className = '', ...rest }) {
  return <input className={`${CONTROL} h-9 ${border(invalid)} ${className}`} {...rest} />;
}

export function Textarea({ invalid, className = '', rows = 4, ...rest }) {
  return <textarea rows={rows} className={`${CONTROL} resize-y py-2 leading-relaxed ${border(invalid)} ${className}`} {...rest} />;
}

export function Select({ invalid, className = '', children, ...rest }) {
  return (
    <div className="relative">
      <select className={`${CONTROL} h-9 appearance-none pr-8 ${border(invalid)} ${className}`} {...rest}>
        {children}
      </select>
      <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </div>
  );
}

// Compact filter select for toolbars (not wrapped in Field - needs an aria-label).
export function FilterSelect({ label, value, onChange, children, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full appearance-none rounded-md border border-line-strong bg-panel pl-2.5 pr-7 text-[12.5px] text-fg hover:border-faint"
      >
        {children}
      </select>
      <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">{label}</label>
        {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-line-strong'}`}
      >
        <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
}
