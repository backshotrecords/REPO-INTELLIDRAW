-- Admin-managed API keys migration
-- Run this in Supabase SQL Editor before deploying the code that reads these columns.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS api_key_source TEXT;

UPDATE users
SET api_key_source = 'user'
WHERE api_key_source IS NULL;

ALTER TABLE users
ALTER COLUMN api_key_source SET DEFAULT 'user';

ALTER TABLE users
ALTER COLUMN api_key_source SET NOT NULL;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS api_key_updated_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS api_key_managed_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_api_key_source_check'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT users_api_key_source_check
    CHECK (api_key_source IN ('user', 'admin'));
  END IF;
END $$;
