import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, Button } from './Button.jsx';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack = []; // open dialogs, topmost last: Esc and Tab apply only to the top one

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', busy = false, initialFocus }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const token = useRef({});

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const me = token.current;
    stack.push(me);
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    const panel = panelRef.current;
    const target = (initialFocus && panel.querySelector(initialFocus))
      || panel.querySelector('[data-autofocus]')
      || panel.querySelector('input:not([type=hidden]),textarea,select')
      || panel.querySelector(FOCUSABLE)
      || panel;
    target.focus();

    function onKeyDown(event) {
      if (stack[stack.length - 1] !== me) return;
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      stack.splice(stack.indexOf(me), 1);
      if (!stack.length) {
        document.body.style.overflow = prevOverflow;
        document.body.style.paddingRight = '';
      }
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-3xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-[var(--overlay)]" onMouseDown={() => !busy && onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-panel shadow-pop sm:max-h-[88dvh] sm:rounded-xl ${width}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-fg">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <IconButton icon="close" label="Close dialog" size="sm" onClick={onClose} disabled={busy} className="-mr-1.5 -mt-0.5" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', tone = 'danger', busy = false, error, children }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone} loading={busy} onClick={onConfirm} data-autofocus={tone !== 'danger' ? true : undefined}>{confirmLabel}</Button>
        </>
      )}
    >
      {error && <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
      {children}
    </Dialog>
  );
}
