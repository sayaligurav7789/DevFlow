CREATE TABLE integration_connections (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'slack')),
  connected_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  external_account_id TEXT,
  external_account_name TEXT NOT NULL DEFAULT '',
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE integration_oauth_states (
  state_hash CHAR(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'slack')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX integration_oauth_states_expiry_idx ON integration_oauth_states (expires_at);

CREATE TABLE project_integrations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'github'),
  external_repository_id TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  linked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, provider),
  UNIQUE (workspace_id, provider, external_repository_id)
);

CREATE TABLE integration_notification_settings (
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'slack'),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  events TEXT[] NOT NULL DEFAULT ARRAY['task_assigned','task_completed','deadline_approaching']::TEXT[],
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, provider)
);

CREATE TRIGGER integration_connections_set_updated_at
  BEFORE UPDATE ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE integration_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'slack'),
  event_type TEXT NOT NULL CHECK (event_type IN ('task_assigned', 'task_completed')),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (JSONB_TYPEOF(payload) = 'object'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX integration_outbox_pending_idx
  ON integration_outbox (available_at, id)
  WHERE delivered_at IS NULL;
