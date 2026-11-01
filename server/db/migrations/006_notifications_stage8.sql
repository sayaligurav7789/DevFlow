-- Stage 8: persistent notifications.
--
-- A notification belongs to exactly one recipient (user_id). Every read and write is scoped by
-- user_id, so one user can never see or mark another user's notifications. workspace_id ties a
-- notification to the workspace it came from (cascade-deleted with it); it is NOT a membership
-- grant: an invitee receives a notification for a workspace they have not joined yet.

CREATE TABLE notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Makes event producers idempotent (e.g. the deadline sweep running on several instances).
  dedupe_key TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_type CHECK (type IN (
    'task.assigned', 'task.reassigned', 'task.updated', 'task.deleted',
    'workspace.invitation', 'deadline.due_soon', 'deadline.overdue'
  )),
  CONSTRAINT notifications_message_length CHECK (LENGTH(message) BETWEEN 1 AND 500),
  CONSTRAINT notifications_data_object CHECK (JSONB_TYPEOF(data) = 'object')
);

-- History: newest first for one user, optionally narrowed to a workspace.
CREATE INDEX notifications_user_feed_idx
  ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_workspace_feed_idx
  ON notifications (user_id, workspace_id, created_at DESC, id DESC);

-- Unread badge and unread-only lists touch only the unread rows.
CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, workspace_id, id DESC)
  WHERE read_at IS NULL;

-- At most one notification per recipient per dedupe key.
CREATE UNIQUE INDEX notifications_user_dedupe_idx
  ON notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Looking up the notification for an invitation (to mark it read on accept / revoke).
CREATE INDEX notifications_entity_idx
  ON notifications (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
