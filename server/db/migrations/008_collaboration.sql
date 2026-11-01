CREATE TABLE workspace_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_documents_name CHECK (LENGTH(BTRIM(file_name)) BETWEEN 1 AND 255),
  CONSTRAINT workspace_documents_size CHECK (file_size BETWEEN 1 AND 5242880)
);
CREATE INDEX workspace_documents_scope_idx ON workspace_documents(workspace_id, created_at DESC);
CREATE INDEX workspace_documents_project_idx ON workspace_documents(project_id, created_at DESC);

CREATE TABLE discussions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  parent_id BIGINT REFERENCES discussions(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT discussions_body_length CHECK (LENGTH(BTRIM(body)) BETWEEN 1 AND 5000)
);
CREATE INDEX discussions_scope_created_idx ON discussions(workspace_id, project_id, created_at DESC);
CREATE INDEX discussions_parent_idx ON discussions(parent_id, created_at ASC) WHERE parent_id IS NOT NULL;

CREATE TABLE discussion_reactions (
  discussion_id BIGINT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL DEFAULT 'like' CHECK (reaction IN ('like', 'celebrate', 'thanks')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discussion_id, user_id, reaction)
);
