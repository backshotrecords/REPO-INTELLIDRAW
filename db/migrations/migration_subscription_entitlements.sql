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
  reset_period_days INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, feature_key)
);

ALTER TABLE plan_feature_rules
  ADD COLUMN IF NOT EXISTS reset_period_days INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plan_feature_rules_reset_period_check'
  ) THEN
    ALTER TABLE plan_feature_rules ADD CONSTRAINT plan_feature_rules_reset_period_check
    CHECK (reset_period_days BETWEEN 0 AND 30);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feature_usage_events_amount_check'
  ) THEN
    ALTER TABLE feature_usage_events ADD CONSTRAINT feature_usage_events_amount_check
    CHECK (amount > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan
  ON user_subscriptions(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_plan_feature_rules_feature
  ON plan_feature_rules(feature_key);
CREATE INDEX IF NOT EXISTS idx_feature_usage_events_user_feature_created
  ON feature_usage_events(user_id, feature_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feature_usage_events_feature_created
  ON feature_usage_events(feature_key, created_at DESC);
