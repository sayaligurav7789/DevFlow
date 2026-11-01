import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

// Accessible dropdown menu. Rendered in a portal with fixed positioning so it is never clipped by
// scrolling tables or dialogs. Supports arrow keys, Home/End, type-less activation, Esc, outside click.
export function Menu({ trigger, items, align = 'start', width = 200, label }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const close = useCallback((restore = true) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 4;
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - menuHeight - 4) : below;
    let left = align === 'end' ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPos({ top, left });
  }, [open, align, width, items.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) setOpen(false);
    };
    const onScroll = (e) => { if (!menuRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Focus the first item only once the menu is positioned and visible (hidden elements can't take focus).
  const positioned = pos !== null;
  useEffect(() => {
    if (open && positioned) menuRef.current?.querySelector('[role^="menuitem"]:not([disabled])')?.focus();
  }, [open, positioned]);

  // Reset so the next open measures again instead of flashing at the old position.
  useEffect(() => { if (!open) setPos(null); }, [open]);

  function onMenuKeyDown(e) {
    const els = [...menuRef.current.querySelectorAll('[role^="menuitem"]:not([disabled])')];
    const index = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(index + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(index - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { close(false); }
  }

  const triggerEl = cloneElement(trigger, {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (e) => { trigger.props.onClick?.(e); setOpen((o) => !o); },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
    },
  });

  return (
    <>
      {triggerEl}
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
          className="anim-pop z-[70] max-h-80 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-pop"
        >
          {items.map((item, i) => {
            if (item.separator) return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-line" />;
            if (item.heading) return <div key={`h-${i}`} className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">{item.heading}</div>;
            const role = item.checked === undefined ? 'menuitem' : 'menuitemradio';
            return (
              <button
                key={item.key ?? item.label}
                type="button"
                role={role}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => { setOpen(false); triggerRef.current?.focus(); item.onSelect?.(); }}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none focus:bg-hover enabled:hover:bg-hover disabled:opacity-40 ${item.danger ? 'text-danger' : 'text-fg'}`}
              >
                {item.icon && <Icon name={item.icon} className="size-3.5 shrink-0 text-faint" />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.checked && <Icon name="check" className="size-3.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
