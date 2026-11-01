import { Icon } from './Icon.jsx';

const TONES = {
  neutral: 'bg-hover text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-4 ${TONES[tone]} ${className}`}>{children}</span>;
}

// Status glyph: ring that fills as work progresses (Linear-style), readable without colour.
export function StatusIcon({ status, className = 'size-3.5' }) {
  const color = { backlog: 'text-faint', todo: 'text-muted', in_progress: 'text-warning', in_review: 'text-accent', done: 'text-success' }[status] ?? 'text-muted';
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0 ${color}`} fill="none" aria-hidden="true">
      {status === 'backlog' ? (
        <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.2" />
      ) : (
        <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      )}
      {status === 'in_progress' && <path d="M8 8V4.5A3.5 3.5 0 0 1 8 11.500Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}
      {status === 'in_review' && <path d="M8 8V3.500A4.500 4.500 0 1 1 3.500 8Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />}
      {status === 'done' && (<><circle cx="8" cy="8" r="5.25" fill="currentColor" stroke="currentColor" strokeWidth="1.5" /><path d="m5.500 8.200 1.700 1.700 3.300-3.600" stroke="var(--canvas)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>)}
    </svg>
  );
}

export function PriorityIcon({ priority, className = 'size-3.5' }) {
  const level = { low: 1, medium: 2, high: 3, urgent: 4 }[priority] ?? 0;
  if (priority === 'urgent') {
    return (
      <span className={`${className} inline-flex shrink-0 items-center justify-center rounded-[3px] bg-danger text-white`} aria-hidden="true">
        <svg viewBox="0 0 16 16" className="size-2.5"><path d="M8 3v6.500M8 11.800v.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </span>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className={`${className} shrink-0 text-muted`} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.500 + i * 4} y={10 - i * 3} width="2.500" height={3 + i * 3} rx=".6" fill="currentColor" opacity={i < level ? 1 : 0.22} />
      ))}
    </svg>
  );
}

export function Label({ children, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2 py-0.5 text-[11.5px] text-muted">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove label ${children}`} className="-mr-1 rounded-full p-0.5 hover:bg-hover hover:text-fg">
          <Icon name="close" className="size-2.5" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
