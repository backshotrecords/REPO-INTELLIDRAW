-- Self-service password reset migration
-- Run this in Supabase SQL Editor before deploying the password reset code.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'self_service',
  created_by_admin UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
ON password_reset_tokens(user_id);

CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx
ON password_reset_tokens(token_hash);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'password_reset_tokens_source_check'
  ) THEN
    ALTER TABLE password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_source_check
    CHECK (source IN ('self_service', 'admin'));
  END IF;
END $$;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
