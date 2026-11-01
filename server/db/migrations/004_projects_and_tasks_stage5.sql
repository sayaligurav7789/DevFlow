ALTER TABLE projects
  ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE tasks
  ADD COLUMN reporter_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN labels TEXT[] NOT NULL DEFAULT '{}';

UPDATE tasks
SET reporter_id = created_by,
    status = CASE WHEN status = 'blocked' THEN 'todo' ELSE status END;

ALTER TABLE tasks
  ALTER COLUMN reporter_id SET NOT NULL,
  DROP CONSTRAINT tasks_status,
  ADD CONSTRAINT tasks_status CHECK (
    status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')
  ),
  ADD CONSTRAINT tasks_labels_count CHECK (CARDINALITY(labels) <= 20),
  ADD CONSTRAINT tasks_labels_non_empty CHECK (
    array_position(labels, '') IS NULL
  );

CREATE INDEX projects_workspace_archive_updated_idx
  ON projects (workspace_id, archived_at, updated_at DESC);
CREATE INDEX tasks_project_created_idx
  ON tasks (project_id, created_at DESC);
CREATE INDEX tasks_reporter_status_idx
  ON tasks (reporter_id, status);
CREATE INDEX activity_logs_task_history_idx
  ON activity_logs (entity_id, created_at DESC, id DESC)
  WHERE entity_type = 'task';
