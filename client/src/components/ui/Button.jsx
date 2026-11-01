import { Icon } from './Icon.jsx';
import { Spinner } from './Feedback.jsx';

const VARIANTS = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 shadow-[inset_0_1px_0_rgb(255_255_255/.12)]',
  secondary: 'border border-line-strong bg-panel text-fg hover:bg-hover disabled:opacity-50',
  ghost: 'text-muted hover:bg-hover hover:text-fg disabled:opacity-50',
  danger: 'bg-danger text-white hover:opacity-90 disabled:opacity-50',
  'danger-ghost': 'text-danger hover:bg-danger-soft disabled:opacity-50',
};
const SIZES = { sm: 'h-7 gap-1.5 px-2.5 text-[12.5px]', md: 'h-8 gap-2 px-3 text-[13px]', lg: 'h-10 gap-2 px-4 text-sm' };

export function Button({ variant = 'secondary', size = 'md', icon, loading = false, className = '', children, type = 'button', disabled, ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : icon ? <Icon name={icon} className="size-3.5" /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className = '', size = 'md', ...rest }) {
  const dim = size === 'sm' ? 'size-7' : 'size-8';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-50 ${className}`}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
