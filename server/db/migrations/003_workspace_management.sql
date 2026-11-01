ALTER TABLE workspaces
  ADD COLUMN description TEXT NOT NULL DEFAULT '',
  ADD COLUMN settings JSONB NOT NULL DEFAULT '{"allowMemberInvites":true}'::JSONB,
  ADD CONSTRAINT workspaces_settings_object CHECK (JSONB_TYPEOF(settings) = 'object'),
  ADD CONSTRAINT workspaces_allow_member_invites_boolean CHECK (
    settings ? 'allowMemberInvites'
    AND JSONB_TYPEOF(settings -> 'allowMemberInvites') = 'boolean'
  );

DROP INDEX workspace_members_user_idx;
CREATE INDEX workspace_members_user_workspace_idx
  ON workspace_members (user_id, workspace_id) INCLUDE (role, joined_at);
CREATE INDEX workspace_members_workspace_role_idx
  ON workspace_members (workspace_id, role);
CREATE UNIQUE INDEX workspace_members_single_owner_idx
  ON workspace_members (workspace_id)
  WHERE role = 'owner';

CREATE TABLE workspace_invitations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT workspace_invitations_email_normalized CHECK (
    email = LOWER(BTRIM(email)) AND LENGTH(BTRIM(email)) > 0
  ),
  CONSTRAINT workspace_invitations_role CHECK (role IN ('admin', 'member')),
  CONSTRAINT workspace_invitations_token_hash_format CHECK (
    token_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT workspace_invitations_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT workspace_invitations_single_terminal_state CHECK (
    accepted_at IS NULL OR revoked_at IS NULL
  )
);

CREATE UNIQUE INDEX workspace_invitations_pending_email_unique
  ON workspace_invitations (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_workspace_status_idx
  ON workspace_invitations (workspace_id, expires_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_email_status_idx
  ON workspace_invitations (email, expires_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
