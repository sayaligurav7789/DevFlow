-- Stage 7: Kanban ordering, project-scoped activity, and dashboard indexes.

-- 1. Persisted order of tasks inside a board column. Gaps of 1024 let a drop
--    insert between two cards with a midpoint, so a move rewrites one row.
ALTER TABLE tasks
  ADD COLUMN position DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE tasks t
SET position = ranked.rank * 1024
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY project_id, status ORDER BY created_at, id) AS rank
  FROM tasks
) ranked
WHERE ranked.id = t.id;

-- Reordering a card is not an edit. The shared set_updated_at() trigger stamps every
-- UPDATE, which would make each drag scramble the "recently updated" sort. Tasks get
-- their own trigger function that leaves updated_at alone when only position changed.
CREATE FUNCTION tasks_set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.position IS DISTINCT FROM OLD.position
     AND (to_jsonb(NEW) - 'position' - 'updated_at') = (to_jsonb(OLD) - 'position' - 'updated_at') THEN
    NEW.updated_at = OLD.updated_at;
  ELSE
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER tasks_set_updated_at ON tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_set_updated_at();

-- 2. Activity rows could not be tied to a project: task events only stored the
--    task id, and the task row disappears when it is deleted. Store the project
--    directly. SET NULL keeps history if the project is later deleted.
ALTER TABLE activity_logs
  ADD COLUMN project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL;

UPDATE activity_logs a
SET project_id = p.id
FROM projects p
WHERE a.entity_type = 'project' AND a.entity_id = p.id;

UPDATE activity_logs a
SET project_id = t.project_id
FROM tasks t
WHERE a.entity_type = 'task' AND a.entity_id = t.id;

-- 3. Indexes, one per query shape.

-- Board columns: WHERE project_id = ? AND status = ? ORDER BY position, id.
-- Its (project_id, status) prefix supersedes tasks_project_status_idx.
CREATE INDEX tasks_board_idx ON tasks (project_id, status, position, id);

-- Dashboard counts: lets the planner answer per-project status, overdue, and
-- assignee aggregates from the index without visiting the table rows.
CREATE INDEX tasks_project_stats_idx
  ON tasks (project_id, status) INCLUDE (due_at, assignee_id);

-- Upcoming deadlines: open tasks with a due date, ordered by date within a project.
CREATE INDEX tasks_project_open_due_idx
  ON tasks (project_id, due_at, id)
  WHERE due_at IS NOT NULL AND status <> 'done';

-- Activity feeds: newest first with a deterministic tie-break on id.
-- The workspace feed supersedes activity_logs_workspace_created_idx.
CREATE INDEX activity_logs_workspace_feed_idx
  ON activity_logs (workspace_id, created_at DESC, id DESC);
CREATE INDEX activity_logs_project_feed_idx
  ON activity_logs (project_id, created_at DESC, id DESC)
  WHERE project_id IS NOT NULL;

DROP INDEX tasks_project_status_idx;
DROP INDEX activity_logs_workspace_created_idx;
