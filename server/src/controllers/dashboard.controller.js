import { pool } from '../db/pool.js';
import { queryWorkspaceActivity } from './activity.controller.js';
import { readDashboardCache, writeDashboardCache } from '../services/cache.service.js';

const UPCOMING_WINDOW_DAYS = 14;
const UPCOMING_LIMIT = 8;
const PROGRESS_LIMIT = 8;
const ACTIVITY_LIMIT = 10;

// "Today" is the start of the current UTC day, matching how due dates are stored (YYYY-MM-DD is
// midnight UTC). A task is overdue once its due date is before today and it is not done.
const TODAY_SQL = `(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

// GET /api/workspaces/:workspaceId/dashboard
// Membership is enforced by requireWorkspaceAccess before this runs. Statistics cover active
// (non-archived) projects; archived projects are counted separately and excluded from task
// figures so finished work does not inflate overdue counts.
//
// Four queries run in one read-only REPEATABLE READ transaction, so every number in the response
// comes from the same snapshot (status distribution always sums to the task total).
async function buildDashboard(workspaceId, userId) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const stats = await client.query(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM projects WHERE workspace_id = $1 AND archived_at IS NULL) AS "activeProjects",
         (SELECT COUNT(*)::INTEGER FROM projects WHERE workspace_id = $1 AND archived_at IS NOT NULL) AS "archivedProjects",
         COUNT(*)::INTEGER AS total,
         COUNT(*) FILTER (WHERE t.status = 'backlog')::INTEGER AS backlog,
         COUNT(*) FILTER (WHERE t.status = 'todo')::INTEGER AS todo,
         COUNT(*) FILTER (WHERE t.status = 'in_progress')::INTEGER AS in_progress,
         COUNT(*) FILTER (WHERE t.status = 'in_review')::INTEGER AS in_review,
         COUNT(*) FILTER (WHERE t.status = 'done')::INTEGER AS done,
         COUNT(*) FILTER (WHERE t.status <> 'done' AND t.due_at < ${TODAY_SQL})::INTEGER AS overdue,
         COUNT(*) FILTER (WHERE t.assignee_id = $2)::INTEGER AS "mineTotal",
         COUNT(*) FILTER (WHERE t.assignee_id = $2 AND t.status <> 'done')::INTEGER AS "mineOpen",
         COUNT(*) FILTER (WHERE t.assignee_id = $2 AND t.status = 'done')::INTEGER AS "mineDone",
         COUNT(*) FILTER (WHERE t.assignee_id = $2 AND t.status <> 'done' AND t.due_at < ${TODAY_SQL})::INTEGER AS "mineOverdue"
       FROM projects p
       JOIN tasks t ON t.project_id = p.id
       WHERE p.workspace_id = $1 AND p.archived_at IS NULL`,
      [workspaceId, userId],
    );

    // Pick the most recently updated projects first, then count only their tasks.
    const progress = await client.query(
      `SELECT p.id::TEXT AS id, p.name, p.slug, s.total, s.done
       FROM (
         SELECT id, name, slug, updated_at FROM projects
         WHERE workspace_id = $1 AND archived_at IS NULL
         ORDER BY updated_at DESC, id DESC LIMIT $2
       ) p
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::INTEGER AS total,
                COUNT(*) FILTER (WHERE status = 'done')::INTEGER AS done
         FROM tasks WHERE project_id = p.id
       ) s
       ORDER BY p.updated_at DESC, p.id DESC`,
      [workspaceId, PROGRESS_LIMIT],
    );

    // Per-project top-N: each project reads only its own slice of tasks_project_open_due_idx, and
    // the global top N is always contained in the union of per-project top N. A plain join lets
    // the planner scan every tenant's due dates instead.
    const upcoming = await client.query(
      `SELECT t.id::TEXT AS id, t.project_id::TEXT AS "projectId", p.name AS "projectName",
              t.title, t.status, t.priority, t.due_at AS "dueAt",
              t.assignee_id::TEXT AS "assigneeId", u.display_name AS "assigneeName"
       FROM projects p
       CROSS JOIN LATERAL (
         SELECT id, project_id, title, status, priority, due_at, assignee_id
         FROM tasks
         WHERE project_id = p.id AND status <> 'done' AND due_at IS NOT NULL
           AND due_at >= ${TODAY_SQL}
           AND due_at < ${TODAY_SQL} + make_interval(days => $2)
         ORDER BY due_at ASC, id ASC
         LIMIT $3
       ) t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE p.workspace_id = $1 AND p.archived_at IS NULL
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT $3`,
      [workspaceId, UPCOMING_WINDOW_DAYS, UPCOMING_LIMIT],
    );

    const activity = await queryWorkspaceActivity(client, workspaceId, { limit: ACTIVITY_LIMIT });
    await client.query('COMMIT');

    const s = stats.rows[0];
    return {
      generatedAt: new Date().toISOString(),
      projects: { active: s.activeProjects, archived: s.archivedProjects },
      tasks: {
        total: s.total,
        completed: s.done,
        open: s.total - s.done,
        overdue: s.overdue,
        completionRate: s.total === 0 ? 0 : Math.round((s.done / s.total) * 100),
        byStatus: { backlog: s.backlog, todo: s.todo, in_progress: s.in_progress, in_review: s.in_review, done: s.done },
      },
      assignedToMe: { total: s.mineTotal, open: s.mineOpen, completed: s.mineDone, overdue: s.mineOverdue },
      projectProgress: progress.rows.map((row) => ({
        id: row.id, name: row.name, slug: row.slug, totalTasks: row.total, doneTasks: row.done,
        progress: row.total === 0 ? 0 : Math.round((row.done / row.total) * 100),
      })),
      upcomingDeadlines: { windowDays: UPCOMING_WINDOW_DAYS, tasks: upcoming.rows },
      recentActivity: activity.rows,
    };
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
  }
}

// Authorization first: requireWorkspaceAccess has already confirmed in PostgreSQL that req.user is
// a current member of req.workspace, so a cached entry is never reachable by a non-member. The
// cache is keyed by workspace AND user because `assignedToMe` is per-user.
// X-Cache reports HIT, MISS (computed and stored), or BYPASS (Redis unavailable, PostgreSQL only).
export async function getDashboard(req, res, next) {
  const workspaceId = req.workspace.id;
  const userId = req.user.id;
  try {
    const cached = await readDashboardCache(workspaceId, userId);
    if (cached.status === 'hit') {
      res.set('X-Cache', 'HIT');
      return res.json(cached.payload);
    }

    const payload = await buildDashboard(workspaceId, userId);
    if (cached.status === 'miss') {
      // Stored under the version token read BEFORE the query: if a write invalidated the workspace
      // while we were computing, this entry lands under a dead token and is never served.
      await writeDashboardCache(workspaceId, userId, cached.version, payload);
    }
    res.set('X-Cache', cached.status === 'miss' ? 'MISS' : 'BYPASS');
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
}
