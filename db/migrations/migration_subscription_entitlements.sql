-- ============================================================
-- IntelliDraw Subscription Entitlements
-- Run this against Supabase before enabling paid plan gates.
-- The serverless helper also creates/seeds these tables on demand.
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  default_required_plan TEXT NOT NULL REFERENCES subscription_plans(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_feature_rules (
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quota INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, feature_key)
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_subscriptions_status_check'
  ) THEN
    ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_status_check
    CHECK (status IN ('active', 'trialing', 'past_due', 'canceled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan
  ON user_subscriptions(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_feature_rules_feature
  ON plan_feature_rules(feature_key);
