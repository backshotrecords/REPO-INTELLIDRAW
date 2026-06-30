-- Token-only signup verification.
-- The table intentionally stores no email, display name, password hash, or signup payload.

CREATE TABLE IF NOT EXISTS signup_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS signup_verification_tokens_token_hash_idx
ON signup_verification_tokens(token_hash);

CREATE INDEX IF NOT EXISTS signup_verification_tokens_expiry_idx
ON signup_verification_tokens(expires_at);
