import { Icon } from './Icon.jsx';
import { Button } from './Button.jsx';

export function Spinner({ className = 'size-4' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} animate-spin`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div role="status" className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted">
      <Spinner className="size-5" />
      <span className="text-[13px]">{label}…</span>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-hover ${className}`} />;
}

export function SkeletonRows({ rows = 5, className = '' }) {
  return (
    <div role="status" aria-label="Loading" className={`divide-y divide-line ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-3.5 flex-1 max-w-xs" />
          <Skeleton className="ml-auto hidden h-3.5 w-16 sm:block" />
          <Skeleton className="hidden h-3.5 w-12 md:block" />
        </div>
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}>
      <div className="mb-4 flex size-10 items-center justify-center rounded-full border border-line bg-raised text-faint">
        <Icon name={icon} className="size-[18px]" />
      </div>
      <h2 className="text-[14px] font-medium text-fg">{title}</h2>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, title = 'Something went wrong', onRetry, className = '' }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center px-6 py-14 text-center ${className}`}>
      <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <Icon name="alert" className="size-[18px]" />
      </div>
      <h2 className="text-[14px] font-medium text-fg">{title}</h2>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{error?.message ?? 'An unexpected error occurred.'}</p>
      {onRetry && <Button className="mt-5" icon="refresh" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

const NOTICE_TONES = {
  error: 'border-danger/30 bg-danger-soft text-danger',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  info: 'border-line bg-raised text-muted',
};
export function Notice({ tone = 'info', children, className = '', title }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ${NOTICE_TONES[tone]} ${className}`}
    >
      <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'} className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-medium">{title}</p>}
        <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
      </div>
    </div>
  );
}
