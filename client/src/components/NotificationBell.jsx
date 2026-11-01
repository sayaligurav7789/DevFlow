import { useCallback, useEffect, useRef, useState } from 'react';
import { notificationApi } from '../lib/endpoints.js';
import { timeAgo } from '../lib/format.js';
import { Icon } from './ui/Icon.jsx';

function notificationIcon(type) {
  if (type === 'workspace.invitation') return 'mail';
  if (type?.includes('due') || type?.includes('overdue')) return 'calendarClock';
  if (type?.includes('assigned')) return 'user';
  if (type?.includes('deleted')) return 'trash';
  return 'message';
}

function NotificationItem({ notification, onMarkRead, busy }) {
  return (
    <div className={`group flex gap-3 border-b border-line px-4 py-3 last:border-b-0 ${notification.read ? 'bg-panel' : 'bg-accent-soft/40'}`}>
      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${notification.read ? 'bg-raised text-muted' : 'bg-accent-soft text-accent'}`}>
        <Icon name={notificationIcon(notification.type)} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[12.5px] leading-5 ${notification.read ? 'text-muted' : 'font-medium text-fg'}`}>
          {notification.message}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
          {notification.workspaceName && <span className="max-w-36 truncate">{notification.workspaceName}</span>}
          {notification.workspaceName && <span aria-hidden="true">·</span>}
          <time dateTime={notification.createdAt}>{timeAgo(notification.createdAt)}</time>
        </div>
      </div>
      {!notification.read && (
        <button
          type="button"
          aria-label="Mark notification as read"
          title="Mark as read"
          disabled={busy}
          onClick={() => onMarkRead(notification.id)}
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted opacity-100 hover:bg-hover hover:text-fg disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        >
          <Icon name="check" className="size-4" />
        </button>
      )}
      {notification.read && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" aria-label="Read" />}
    </div>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const rootRef = useRef(null);

  const refreshCount = useCallback(async () => {
    try {
      const data = await notificationApi.unreadCount();
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // Keep the last known count; the dropdown can surface a fetch error when opened.
    }
  }, []);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await notificationApi.list({ page: 1, limit: 10 });
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch (e) {
      setError(e.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, 60000);
    return () => window.clearInterval(timer);
  }, [refreshCount]);

  useEffect(() => {
    if (open) refreshList();
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  async function markRead(id) {
    setBusyId(id);
    try {
      await notificationApi.markRead(id);
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (e) {
      setError(e.message || 'Could not update this notification.');
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const data = await notificationApi.markAllRead();
      setNotifications((current) => current.map((item) => ({ ...item, read: true })));
      setUnreadCount(data.unreadCount ?? 0);
    } catch (e) {
      setError(e.message || 'Could not mark notifications as read.');
    } finally {
      setMarkingAll(false);
    }
  }

  const hasUnread = unreadCount > 0;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Icon name="bell" className="size-[18px]" />
        {hasUnread && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-canvas bg-danger px-1 text-[9px] font-semibold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Notifications"
          className="anim-pop absolute right-0 top-[calc(100%+10px)] z-50 w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-panel shadow-pop"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold text-fg">Notifications</h2>
              <p className="mt-0.5 text-[11px] text-faint">
                {unreadCount === 0 ? 'You are all caught up' : `${unreadCount} unread`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Refresh notifications"
                title="Refresh"
                onClick={refreshList}
                disabled={loading}
                className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-hover disabled:opacity-50"
              >
                <Icon name="refresh" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {hasUnread && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={markingAll}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50"
                >
                  {markingAll ? 'Updating…' : 'Mark all read'}
                </button>
              )}
            </div>
          </header>

          {error && (
            <div role="alert" className="border-b border-line bg-danger-soft px-4 py-2 text-[12px] text-danger">
              {error}
              <button type="button" onClick={refreshList} className="ml-2 font-semibold underline">Retry</button>
            </div>
          )}

          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-[12px] text-muted">
                <Icon name="refresh" className="size-4 animate-spin" />
                Loading notifications…
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-raised text-muted">
                  <Icon name="inbox" className="size-5" />
                </span>
                <p className="text-[12.5px] font-medium text-fg">You're all caught up</p>
                <p className="mt-1 text-[11px] text-faint">New task and workspace updates will appear here.</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={markRead}
                  busy={busyId === notification.id}
                />
              ))
            )}
          </div>
          <footer className="border-t border-line bg-raised px-4 py-2">
            <p className="text-center text-[10.5px] text-faint">Showing your 10 most recent notifications</p>
          </footer>
        </section>
      )}
    </div>
  );
}
