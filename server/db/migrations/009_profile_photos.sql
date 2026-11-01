ALTER TABLE users
  ADD COLUMN avatar_data BYTEA,
  ADD COLUMN avatar_mime_type TEXT,
  ADD CONSTRAINT users_avatar_pair CHECK (
    (avatar_data IS NULL AND avatar_mime_type IS NULL) OR
    (avatar_data IS NOT NULL AND avatar_mime_type IN ('image/jpeg', 'image/png', 'image/webp') AND octet_length(avatar_data) BETWEEN 1 AND 2097152)
  );
