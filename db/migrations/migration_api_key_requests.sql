-- Track users who request an admin-managed API key through the community CTA.
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_request_status TEXT DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_request_channel TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_request_note TEXT;

UPDATE users
SET api_key_request_status = 'fulfilled'
WHERE api_key_encrypted IS NOT NULL
  AND COALESCE(api_key_request_status, 'none') = 'none';

UPDATE users
SET api_key_request_status = 'none'
WHERE api_key_request_status IS NULL;

ALTER TABLE users ALTER COLUMN api_key_request_status SET DEFAULT 'none';
ALTER TABLE users ALTER COLUMN api_key_request_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_api_key_request_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_api_key_request_status_check
      CHECK (api_key_request_status IN ('none', 'requested', 'fulfilled', 'dismissed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_api_key_request_status
  ON users(api_key_request_status, api_key_requested_at DESC);
