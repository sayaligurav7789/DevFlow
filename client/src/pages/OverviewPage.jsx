
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useWorkspace } from '../layouts/WorkspaceScope.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { useMembers } from '../hooks/useMembers.js';
import { workspaceApi } from '../lib/endpoints.js';
import { dueLabel, daysUntil, timeAgo } from '../lib/format.js';
import { ActivityFeed } from '../components/ActivityFeed.jsx';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  PriorityIcon,
  Skeleton,
  SkeletonRows,
  StatusIcon,
} from '../components/ui/index.js';

function Stat({ label, value, hint, to, tone, loading, symbol }) {
  const content = (
    <div className="relative flex h-full flex-col justify-between gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className="flex size-9 items-center justify-center rounded-xl bg-raised text-base text-accent">
          {symbol}
        </span>
      </div>

      <div>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <p className={`text-3xl font-semibold tracking-tight tabular-nums ${tone ?? 'text-fg'}`}>
            {value ?? 0}
          </p>
        )}

        {loading ? (
          <Skeleton className="mt-2 h-3 w-24" />
        ) : (
          <p className="mt-1.5 text-[12px] text-faint">{hint}</p>
        )}
      </div>
    </div>
  );

  const cls =
    'group block min-h-[142px] rounded-2xl border border-line bg-panel p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-raised hover:shadow-md sm:p-5';

  return to ? (
    <Link to={to} className={cls}>{content}</Link>
  ) : (
    <div className="min-h-[142px] rounded-2xl border border-line bg-panel p-4 sm:p-5">
      {content}
    </div>
  );
}

function QuickAction({ to, symbol, title, description }) {
  return (
    <Link
      to={to}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-panel p-3 transition-all duration-200 hover:border-line-strong hover:bg-raised"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg text-accent transition-transform group-hover:scale-105">
        {symbol}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-fg">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-faint">
          {description}
        </span>
      </span>
      <span className="ml-auto text-muted transition-transform group-hover:translate-x-1">
        →
      </span>
    </Link>
  );
}

const STATUS_CONFIG = {
  backlog: { label: 'Backlog', color: '#8b8b98' },
  todo: { label: 'Todo', color: '#a1a1aa' },
  in_progress: { label: 'In Progress', color: '#e9aa45' },
  in_review: { label: 'In Review', color: '#818cf8' },
  done: { label: 'Done', color: '#43c58b' },
};

function TaskDonutChart({ byStatus = {}, total = 0 }) {
  const entries = Object.entries(STATUS_CONFIG).map(([key, config]) => ({
    key,
    ...config,
    value: Number(byStatus?.[key] ?? 0),
  }));

  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-6 py-3 sm:flex-row sm:justify-around">
      <div className="relative size-48 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--line)"
            strokeWidth="11"
          />

          {entries.map((entry) => {
            const length =
              total > 0 ? (entry.value / total) * circumference : 0;

            const currentOffset = offset;
            offset += length;

            if (!entry.value) return null;

            return (
              <circle
                key={entry.key}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={entry.color}
                strokeWidth="11"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-currentOffset}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-fg">
            {total}
          </span>
          <span className="text-[11px] text-muted">Total tasks</span>
        </div>
      </div>

      <div className="grid w-full grid-cols-2 gap-x-5 gap-y-4 sm:w-auto sm:min-w-44 sm:grid-cols-1">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="flex-1 text-[12px] text-muted">
              {entry.label}
            </span>
            <span className="text-[12px] font-semibold tabular-nums text-fg">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectProgressChart({ projects = [], workspaceId }) {
  if (!projects.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm font-medium text-fg">No projects yet</p>
        <p className="mt-1 text-xs text-muted">
          Create a project to see progress here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-5">
      {projects.map((project) => {
        const progress = Math.max(
          0,
          Math.min(100, Number(project.progress) || 0),
        );

        return (
          <div key={project.id}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Link
                to={`/workspaces/${workspaceId}/projects/${project.id}/board`}
                className="min-w-0 truncate text-[12.5px] font-medium text-fg hover:text-accent"
              >
                {project.name}
              </Link>

              <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                {project.totalTasks === 0 ? '—' : `${progress}%`}
              </span>
            </div>

            <div
              className="h-3 overflow-hidden rounded-full bg-hover"
              role="progressbar"
              aria-label={`${project.name} completion`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className="h-full rounded-full bg-success transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>

            <p className="mt-1.5 text-[10px] text-faint">
              {project.doneTasks} of {project.totalTasks} tasks completed
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function OverviewPage() {
  const { workspace, canManage } = useWorkspace();
  const { user } = useAuth();
  const { members } = useMembers(workspace.id);

  const base = `/workspaces/${workspace.id}`;

  const {
    data,
    error,
    loading,
    refreshing,
    reload,
  } = useFetch(
    (signal) => workspaceApi.dashboard(workspace.id, { signal }),
    [workspace.id],
  );

  const nameOf = (id) =>
    members.find((m) => m.id === String(id))?.displayName ?? 'a teammate';

  const initial = loading && !data;
  const t = data?.tasks;
  const mine = data?.assignedToMe;

  return (
    <div className="space-y-7">

      {/* Dashboard heading */}
      <PageHeader
        title={`Hi, ${user.displayName.split(' ')[0]} 👋`}
        description={
          workspace.description ||
          `Here's where ${workspace.name} stands right now.`
        }
        actions={(
          <div className="flex items-center gap-3">
            {data && (
              <span className="hidden text-[11px] text-faint sm:inline">
                Updated {timeAgo(data.generatedAt)}
              </span>
            )}
            <Button icon="refresh" onClick={reload} loading={refreshing}>
              Refresh
            </Button>
          </div>
        )}
      />

      {error && !data ? (
        <Card>
          <ErrorState
            error={error}
            title="Couldn't load the dashboard"
            onRetry={reload}
          />
        </Card>
      ) : (
        <>
          {/* KPI section */}
          <section aria-label="Key figures" className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Workspace overview
                </h2>
                <p className="mt-1 text-[12px] text-faint">
                  A snapshot of your team's progress
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Stat
                symbol="▦"
                label="Projects"
                value={data?.projects.active}
                hint={data ? `${data.projects.archived} archived` : ''}
                to={`${base}/projects`}
                loading={initial}
              />

              <Stat
                symbol="☷"
                label="Total tasks"
                value={t?.total}
                hint={t ? `${t.open} open tasks` : ''}
                loading={initial}
              />

              <Stat
                symbol="✓"
                label="Completed"
                value={t?.completed}
                hint={t ? `${t.completionRate}% completion rate` : ''}
                tone="text-success"
                loading={initial}
              />

              <Stat
                symbol="◷"
                label="Overdue"
                value={t?.overdue}
                hint="Past due and not done"
                tone={t?.overdue ? 'text-danger' : 'text-fg'}
                loading={initial}
              />

              <Stat
                symbol="♙"
                label="Assigned to me"
                value={mine?.open}
                hint={mine ? `${mine.overdue} overdue · ${mine.completed} done` : ''}
                to={`${base}/tasks`}
                loading={initial}
              />
            </div>

            {data && (
              <p className="text-[11px] text-faint">
                Figures cover active projects; archived projects are excluded.
              </p>
            )}
          </section>

          {/* Quick actions */}
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">Quick actions</h2>
              <p className="mt-1 text-[12px] text-faint">
                Jump straight into your workspace
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {canManage && (
                <QuickAction
                  to={`${base}/projects`}
                  symbol="+"
                  title="Create a project"
                  description="Start organizing new work"
                />
              )}

              <QuickAction
                to={`${base}/tasks`}
                symbol="☷"
                title="View my tasks"
                description="Check your assigned work"
              />

              <QuickAction
                to={`${base}/team`}
                symbol="♧"
                title="View your team"
                description="Collaborate with teammates"
              />
            </div>
          </section>

          {/* Visual analytics */}
          <div className="grid gap-5 lg:grid-cols-5">

            {/* Task distribution donut chart */}
            <Card className="overflow-hidden lg:col-span-3">
              <CardHeader
                title="Task distribution"
                description="Visual breakdown of tasks by status"
              />

              <div className="p-4 sm:p-5">
                {initial ? (
                  <Skeleton className="h-48 w-full" />
                ) : t.total === 0 ? (
                  <EmptyState
                    icon="tasks"
                    title="No tasks yet"
                    description="Create tasks to see their distribution."
                    className="py-8"
                  />
                ) : (
                  <TaskDonutChart
                    byStatus={t.byStatus}
                    total={t.total}
                  />
                )}
              </div>
            </Card>

            {/* Project progress bar chart */}
            <Card className="overflow-hidden lg:col-span-2">
              <CardHeader
                title="Project completion"
                description="Progress by project"
                actions={(
                  <Link
                    to={`${base}/projects`}
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    View all →
                  </Link>
                )}
              />

              {initial ? (
                <div className="p-4">
                  <SkeletonRows rows={3} />
                </div>
              ) : (
                <ProjectProgressChart
                  projects={data.projectProgress}
                  workspaceId={workspace.id}
                />
              )}
            </Card>

          </div>

          {/* Deadlines and activity */}
          <div className="grid gap-5 lg:grid-cols-5">

            {/* Upcoming deadlines */}
            <Card className="overflow-hidden lg:col-span-3">
              <CardHeader
                title="Upcoming deadlines"
                description={
                  data
                    ? `Open tasks due in the next ${data.upcomingDeadlines.windowDays} days`
                    : 'Keep an eye on approaching deadlines'
                }
              />

              {initial ? (
                <div className="p-4">
                  <SkeletonRows rows={4} />
                </div>
              ) : data.upcomingDeadlines.tasks.length === 0 ? (
                <EmptyState
                  icon="calendar"
                  title="Nothing due soon"
                  description="Open tasks with a due date in the next two weeks appear here."
                  className="py-10"
                />
              ) : (
                <ul className="divide-y divide-line">
                  {data.upcomingDeadlines.tasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        to={`${base}/projects/${task.projectId}?task=${task.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-raised sm:px-5"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised">
                          <StatusIcon
                            status={task.status}
                            className="size-4"
                          />
                        </span>

                        <PriorityIcon
                          priority={task.priority}
                          className="size-4 shrink-0"
                        />

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-fg">
                            {task.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted">
                            {task.projectName}
                          </span>
                        </span>

                        {task.assigneeId && (
                          <Avatar
                            name={task.assigneeName}
                            id={task.assigneeId}
                            size="xs"
                          />
                        )}

                        <span
                          className={`w-[76px] shrink-0 text-right text-[11px] font-medium ${
                            daysUntil(task.dueAt) === 0
                              ? 'text-warning'
                              : 'text-muted'
                          }`}
                        >
                          {dueLabel(task.dueAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Recent activity */}
            <Card className="overflow-hidden lg:col-span-2">
              <CardHeader
                title="Recent activity"
                description="Latest workspace updates"
                actions={(
                  <Link
                    to={`${base}/activity`}
                    className="text-[12px] font-medium text-accent hover:underline"
                  >
                    View all →
                  </Link>
                )}
              />

              {initial ? (
                <div className="p-4">
                  <SkeletonRows rows={4} />
                </div>
              ) : data.recentActivity.length === 0 ? (
                <EmptyState
                  icon="clock"
                  title="No activity yet"
                  description="Changes to projects and tasks are recorded here."
                  className="py-8"
                />
              ) : (
                <ActivityFeed
                  entries={data.recentActivity}
                  workspaceId={workspace.id}
                  nameOf={nameOf}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
