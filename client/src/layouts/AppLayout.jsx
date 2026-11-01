import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatches, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useWorkspaces } from '../context/WorkspaceContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Avatar, Icon, IconButton, Menu } from '../components/ui/index.js';
import { NotificationBell } from '../components/NotificationBell.jsx';
import { DevFlowAI } from '../components/DevFlowAI.jsx';

const COLLAPSE_KEY = 'devflow:sidebar-collapsed';


function Logo({ collapsed }) {
  return (
    <Link
      to="/"
      className="flex items-center gap-2 rounded-md px-1 py-0.5"
      aria-label="DevFlow home"
    >
      <img
        src="/devflow-logo.png"
        alt="DevFlow"
        className="h-10 w-10 shrink-0 object-contain"
      />

      {!collapsed && (
        <span className="text-[14px] font-semibold tracking-tight text-fg">
          DevFlow
        </span>
      )}
    </Link>
  );
}

function WorkspaceSwitcher({ collapsed }) {
  const { workspaces, current, selectWorkspace } = useWorkspaces();
  const navigate = useNavigate();
  const items = [
    { heading: 'Workspaces' },
    ...workspaces.map((w) => ({
      key: w.id,
      label: w.name,
      checked: w.id === current?.id,
      onSelect: () => { selectWorkspace(w.id); navigate(`/workspaces/${w.id}`); },
    })),
    { separator: true },
    { key: 'all', label: 'All workspaces', icon: 'folder', onSelect: () => navigate('/workspaces') },
    { key: 'new', label: 'Create workspace', icon: 'plus', onSelect: () => navigate('/workspaces?new=1') },
  ];
  return (
    <Menu
      label="Switch workspace"
      width={232}
      items={items}
      trigger={(
        <button
          type="button"
          aria-label={`Workspace: ${current?.name ?? 'No workspace'}. Switch workspace`}
          className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-hover ${collapsed ? 'justify-center' : ''}`}
        >
          <span
            aria-hidden="true"
            data-letter={current ? current.name.slice(0, 1).toUpperCase() : '?'}
            className="flex size-6 shrink-0 items-center justify-center rounded-md border border-line-strong bg-raised text-[11px] font-semibold text-fg before:content-[attr(data-letter)]"
          />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{current?.name ?? 'No workspace'}</span>
              <Icon name="chevronsUpDown" className="size-3.5 text-faint" />
            </>
          )}
        </button>
      )}
    />
  );
}

function NavItem({ to, icon, label, collapsed, end, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={({ isActive }) => `flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${collapsed ? 'justify-center' : ''} ${isActive ? 'bg-active font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
    >
      <Icon name={icon} className="size-4 shrink-0" />
      {collapsed ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </NavLink>
  );
}


function UserMenu({ collapsed }) {
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();

  const items = [
    { heading: user.email },
    {
      key: 'settings',
      label: 'Profile & settings',
      icon: 'user',
      onSelect: () => navigate('/settings'),
    },
    { separator: true },
    { heading: 'Theme' },
    {
      key: 'light',
      label: 'Light',
      icon: 'sun',
      checked: preference === 'light',
      onSelect: () => setPreference('light'),
    },
    {
      key: 'dark',
      label: 'Dark',
      icon: 'moon',
      checked: preference === 'dark',
      onSelect: () => setPreference('dark'),
    },
    {
      key: 'system',
      label: 'System',
      icon: 'monitor',
      checked: preference === 'system',
      onSelect: () => setPreference('system'),
    },
    { separator: true },
    {
      key: 'logout',
      label: 'Sign out',
      icon: 'logout',
      onSelect: async () => {
        try {
          await logout();
          navigate('/login', { replace: true });
        } catch (e) {
          toast.error(e.message);
        }
      },
    },
  ];

  return (
    <Menu
      label="Account"
      width={232}
      align="start"
      items={items}
      trigger={(
        <button
          type="button"
          aria-label={`Account menu for ${user.displayName}`}
          className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-hover ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Avatar
            name={user.displayName}
            id={user.id}
            src="/api/auth/me/photo"
            size="md"
          />

          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
              {user.displayName}
            </span>
          )}
        </button>
      )}
    />
  );
}

function SidebarContent({ collapsed, onNavigate, onToggle, showToggle }) {
  const { current } = useWorkspaces();
  const base = current ? `/workspaces/${current.id}` : null;
  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-12 items-center ${collapsed ? 'justify-center' : 'justify-between px-3'}`}>
        <Logo collapsed={collapsed} />
        {showToggle && !collapsed && <IconButton icon="panel" label="Collapse sidebar" size="sm" onClick={onToggle} />}
      </div>
      <div className="px-2"><WorkspaceSwitcher collapsed={collapsed} /></div>
      <nav aria-label="Primary" className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
        {base ? (
          <>
            <NavItem to={base} end icon="home" label="Dashboard" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem to={`${base}/tasks`} icon="tasks" label="My tasks" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem to={`${base}/projects`} icon="folder" label="Projects" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem to={`${base}/activity`} icon="clock" label="Activity" collapsed={collapsed} onNavigate={onNavigate} />
            <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-faint">Collaboration</div>
            <NavItem to={`${base}/team`} icon="users" label="Team" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem to={`${base}/documents`} icon="file" label="Documents" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem to={`${base}/discussions`} icon="message" label="Discussions" collapsed={collapsed} onNavigate={onNavigate} />
            <NavItem to={`${base}/integrations`} icon="link" label="Integrations" collapsed={collapsed} onNavigate={onNavigate} />
            <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-faint">Settings</div>
            <NavItem to={`${base}/settings`} icon="settings" label="Workspace settings" collapsed={collapsed} onNavigate={onNavigate} />
          </>
        ) : (
          <NavItem to="/workspaces" icon="folder" label="Workspaces" collapsed={collapsed} onNavigate={onNavigate} />
        )}
      </nav>
      <div className="space-y-0.5 border-t border-line p-2">
        {showToggle && collapsed && (
          <button type="button" onClick={onToggle} aria-label="Expand sidebar" title="Expand sidebar" className="flex h-8 w-full items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <Icon name="panel" />
          </button>
        )}
        <UserMenu collapsed={collapsed} />
      </div>
    </div>
  );
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  // Routes can opt out of the reading-width cap (the Kanban board needs the whole window).
  const wide = useMatches().some((match) => match.handle?.wide);
  const drawerRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Mobile drawer: Esc closes, focus moves in, and returns to the hamburger.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const trigger = menuButtonRef.current;
    drawerRef.current?.querySelector('a,button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); trigger?.focus(); };
  }, [drawerOpen]);

  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  }

  return (
    <div className="flex h-dvh bg-canvas text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg">Skip to content</a>

      {/* Tablet/desktop sidebar */}
      <aside
        aria-label="Sidebar"
        className={`hidden shrink-0 border-r border-line bg-sidebar transition-[width] duration-200 md:block ${collapsed ? 'w-14' : 'w-60'}`}
      >
        <SidebarContent collapsed={collapsed} onToggle={toggle} showToggle />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="anim-fade absolute inset-0 bg-[var(--overlay)]" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside ref={drawerRef} aria-label="Sidebar" className="anim-drawer relative h-full w-72 max-w-[85vw] border-r border-line bg-sidebar shadow-pop">
            <SidebarContent collapsed={false} onNavigate={() => setDrawerOpen(false)} showToggle={false} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b border-line bg-panel px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <IconButton ref={menuButtonRef} icon="menu" label="Open navigation" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} />
            <Logo collapsed={false} />
          </div>
          <div className="ml-auto flex items-center">
            <NotificationBell />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <div className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8 ${wide ? 'max-w-none' : 'max-w-6xl'}`}>
            <Outlet />
          </div>
        </main>
      </div>
      <DevFlowAI />
    </div>
  );
}
