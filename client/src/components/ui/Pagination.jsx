import { Button } from './Button.jsx';

export function Pagination({ pagination, onPage, noun = 'items', disabled }) {
  if (!pagination || pagination.total === 0) return null;
  const { page, limit, total, totalPages } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row">
      <p className="text-[12.5px] text-muted" aria-live="polite">
        Showing <span className="font-medium text-fg">{from}–{to}</span> of <span className="font-medium text-fg">{total}</span> {noun}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" icon="chevronLeft" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">Prev</Button>
          <span className="min-w-20 text-center text-[12.5px] text-muted">Page {page} of {totalPages}</span>
          <Button size="sm" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
            Next
          </Button>
        </div>
      )}
    </nav>
  );
}
