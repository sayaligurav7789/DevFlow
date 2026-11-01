ALTER TABLE users
  ADD COLUMN email_verified_at TIMESTAMPTZ,
  ADD COLUMN pending_email TEXT,
  ADD CONSTRAINT users_pending_email_normalized CHECK (
    pending_email IS NULL OR (pending_email = LOWER(BTRIM(pending_email)) AND LENGTH(BTRIM(pending_email)) > 0)
  );

CREATE TABLE account_action_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  pending_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT account_action_tokens_purpose CHECK (purpose IN ('verify_email', 'reset_password', 'change_email')),
  CONSTRAINT account_action_tokens_hash_format CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT account_action_tokens_expiry CHECK (expires_at > created_at),
  CONSTRAINT account_action_tokens_email CHECK (pending_email IS NULL OR pending_email = LOWER(BTRIM(pending_email)))
);
CREATE INDEX account_action_tokens_user_purpose_idx ON account_action_tokens (user_id, purpose, expires_at DESC);
CREATE INDEX account_action_tokens_expiry_idx ON account_action_tokens (expires_at);
CREATE UNIQUE INDEX users_pending_email_unique ON users (pending_email) WHERE pending_email IS NOT NULL;
