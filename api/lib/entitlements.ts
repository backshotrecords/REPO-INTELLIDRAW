import type { VercelResponse } from "@vercel/node";
import { supabase } from "./db.js";

export const PLAN_DEFINITIONS = [
  { id: "free", name: "Free", rank: 0, description: "Starter access for individual diagramming." },
  { id: "pro", name: "Pro", rank: 10, description: "Paid access for core AI, projects, publishing, and exports." },
  { id: "max", name: "Max", rank: 20, description: "Top-tier access for collaboration, meeting mode, and advanced skills." },
] as const;

export type SubscriptionPlanId = typeof PLAN_DEFINITIONS[number]["id"];

export type FeatureKey =
  | "canvas.create"
  | "canvas.ai_chat"
  | "canvas.auto_fix"
  | "canvas.upload_file"
  | "canvas.publish_public"
  | "history.version_tree"
  | "project.create"
  | "project.context"
  | "project.assets"
  | "project.asset_links"
  | "project.share_groups"
  | "dashboard.tree_view"
  | "export.markdown"
  | "export.png"
  | "export.zip"
  | "voice.dictation"
  | "voice.meeting_mode"
  | "skills.create"
  | "skills.install_marketplace"
  | "skills.attach_canvas"
  | "skills.attach_global"
  | "skills.trigger_manual"
  | "skills.trigger_automatic"
  | "skills.trigger_contextual"
  | "skills.publish_public"
  | "skills.share_private"
  | "skills.remix"
  | "groups.create"
  | "groups.manage_members"
  | "managed_api_key.request";

type FeatureDefinition = {
  key: FeatureKey;
  label: string;
  description: string;
  category: string;
  defaultPlan: SubscriptionPlanId;
  defaultQuotas?: Partial<Record<SubscriptionPlanId, number>>;
};

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    key: "canvas.create",
    label: "Create canvases",
    description: "Create new diagram canvases.",
    category: "Canvas",
    defaultPlan: "free",
    defaultQuotas: { free: 5 },
  },
  {
    key: "canvas.ai_chat",
    label: "AI canvas chat",
    description: "Use the assistant to generate and edit Mermaid diagrams.",
    category: "Canvas AI",
    defaultPlan: "pro",
  },
  {
    key: "canvas.auto_fix",
    label: "Auto-fix Mermaid",
    description: "Ask the assistant to repair broken Mermaid syntax.",
    category: "Canvas AI",
    defaultPlan: "pro",
  },
  {
    key: "canvas.upload_file",
    label: "Upload to diagram",
    description: "Convert images and documents into diagrams.",
    category: "Canvas AI",
    defaultPlan: "pro",
  },
  {
    key: "canvas.publish_public",
    label: "Publish public links",
    description: "Publish canvases to public share URLs.",
    category: "Publishing",
    defaultPlan: "pro",
  },
  {
    key: "history.version_tree",
    label: "Version tree",
    description: "View and restore canvas commit history.",
    category: "History",
    defaultPlan: "pro",
  },
  {
    key: "project.create",
    label: "Projects and folders",
    description: "Create project folders and nested organization.",
    category: "Projects",
    defaultPlan: "pro",
  },
  {
    key: "project.context",
    label: "Project context",
    description: "Generate inherited project context for canvases.",
    category: "Projects",
    defaultPlan: "pro",
  },
  {
    key: "project.assets",
    label: "Project assets",
    description: "Register reusable markdown, canvas, and folder assets inside project trees.",
    category: "Projects",
    defaultPlan: "pro",
  },
  {
    key: "project.asset_links",
    label: "Asset-node links",
    description: "Link project assets to canvas nodes and track relationship metadata.",
    category: "Projects",
    defaultPlan: "pro",
  },
  {
    key: "project.share_groups",
    label: "Share projects with groups",
    description: "Share project folders with user groups and roles.",
    category: "Collaboration",
    defaultPlan: "max",
  },
  {
    key: "dashboard.tree_view",
    label: "Dashboard tree view",
    description: "Use the visual project/canvas tree view.",
    category: "Dashboard",
    defaultPlan: "pro",
  },
  {
    key: "export.markdown",
    label: "Markdown export",
    description: "Export a canvas as Markdown.",
    category: "Export",
    defaultPlan: "free",
  },
  {
    key: "export.png",
    label: "PNG export",
    description: "Export rendered diagrams as images.",
    category: "Export",
    defaultPlan: "pro",
  },
  {
    key: "export.zip",
    label: "Bulk ZIP export",
    description: "Export multiple canvases or mixed formats as a ZIP.",
    category: "Export",
    defaultPlan: "max",
  },
  {
    key: "voice.dictation",
    label: "Voice input",
    description: "Transcribe voice into canvas prompts.",
    category: "Voice",
    defaultPlan: "pro",
  },
  {
    key: "voice.meeting_mode",
    label: "Meeting Mode",
    description: "Process live meeting chunks into canvas updates.",
    category: "Voice",
    defaultPlan: "max",
  },
  {
    key: "skills.create",
    label: "Create private skills",
    description: "Write reusable private Skill Notes.",
    category: "Skills",
    defaultPlan: "pro",
  },
  {
    key: "skills.install_marketplace",
    label: "Install marketplace skills",
    description: "Install shared or public Skill Notes.",
    category: "Skills",
    defaultPlan: "pro",
  },
  {
    key: "skills.attach_canvas",
    label: "Canvas skills",
    description: "Attach skills to individual canvases.",
    category: "Skills",
    defaultPlan: "pro",
  },
  {
    key: "skills.attach_global",
    label: "Global skills",
    description: "Attach skills globally across canvases.",
    category: "Skills",
    defaultPlan: "max",
  },
  {
    key: "skills.trigger_manual",
    label: "Manual skill triggers",
    description: "Run a Skill Note manually on a canvas.",
    category: "Skills",
    defaultPlan: "pro",
  },
  {
    key: "skills.trigger_automatic",
    label: "Automatic skill triggers",
    description: "Automatically inject active skills into AI canvas chat.",
    category: "Skills",
    defaultPlan: "max",
  },
  {
    key: "skills.trigger_contextual",
    label: "Contextual skills",
    description: "Add contextual Skill Notes into the prompt composer.",
    category: "Skills",
    defaultPlan: "max",
  },
  {
    key: "skills.publish_public",
    label: "Publish skills",
    description: "Publish Skill Notes to the marketplace.",
    category: "Skills",
    defaultPlan: "max",
  },
  {
    key: "skills.share_private",
    label: "Share skills privately",
    description: "Share released Skill Notes with users or groups.",
    category: "Skills",
    defaultPlan: "max",
  },
  {
    key: "skills.remix",
    label: "Remix installed skills",
    description: "Create private copies of installed Skill Notes.",
    category: "Skills",
    defaultPlan: "pro",
  },
  {
    key: "groups.create",
    label: "Create user groups",
    description: "Create groups for skill and project sharing.",
    category: "Collaboration",
    defaultPlan: "max",
  },
  {
    key: "groups.manage_members",
    label: "Manage group members",
    description: "Add or remove members from owned user groups.",
    category: "Collaboration",
    defaultPlan: "max",
  },
  {
    key: "managed_api_key.request",
    label: "Request managed API key",
    description: "Request an admin-managed OpenAI API key.",
    category: "Account",
    defaultPlan: "max",
  },
];

type PlanRow = {
  id: string;
  name: string;
  rank: number;
  description: string | null;
};

type FeatureRow = {
  key: string;
  label: string;
  description: string | null;
  category: string;
  default_required_plan: string;
};

type RuleRow = {
  plan_id: string;
  feature_key: string;
  enabled: boolean;
  quota: number | null;
  reset_period_days: number;
};

export type FeatureAccess = {
  key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  quota: number | null;
  resetPeriodDays: number;
  usage: number | null;
  requiredPlan: string;
  defaultRequiredPlan: string;
};

export type EntitlementSnapshot = {
  plan: PlanRow;
  plans: PlanRow[];
  features: FeatureAccess[];
  featureMap: Record<string, FeatureAccess>;
};

let schemaPromise: Promise<void> | null = null;

function planRank(planId: string) {
  return PLAN_DEFINITIONS.find((plan) => plan.id === planId)?.rank ?? 0;
}

function defaultEnabledFor(planId: string, feature: FeatureDefinition) {
  return planRank(planId) >= planRank(feature.defaultPlan);
}

function defaultQuotaFor(planId: string, feature: FeatureDefinition) {
  return feature.defaultQuotas?.[planId as SubscriptionPlanId] ?? null;
}

function defaultResetPeriodFor() {
  return 0;
}

async function seedEntitlementData() {
  await supabase.rpc("exec_sql", {
    sql: `
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
    `,
  });

  await supabase
    .from("subscription_plans")
    .upsert(
      PLAN_DEFINITIONS.map((plan) => ({
        id: plan.id,
        name: plan.name,
        rank: plan.rank,
        description: plan.description,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    );

  await supabase
    .from("feature_flags")
    .upsert(
      FEATURE_DEFINITIONS.map((feature) => ({
        key: feature.key,
        label: feature.label,
        description: feature.description,
        category: feature.category,
        default_required_plan: feature.defaultPlan,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "key" },
    );

  const { data: existingRules } = await supabase
    .from("plan_feature_rules")
    .select("plan_id, feature_key");
  const existingRuleKeys = new Set(
    ((existingRules || []) as Array<{ plan_id: string; feature_key: string }>).map(
      (rule) => `${rule.plan_id}:${rule.feature_key}`,
    ),
  );
  const defaultRules = PLAN_DEFINITIONS.flatMap((plan) => (
    FEATURE_DEFINITIONS.map((feature) => ({
      plan_id: plan.id,
      feature_key: feature.key,
      enabled: defaultEnabledFor(plan.id, feature),
      quota: defaultQuotaFor(plan.id, feature),
      reset_period_days: defaultResetPeriodFor(),
    }))
  )).filter((rule) => !existingRuleKeys.has(`${rule.plan_id}:${rule.feature_key}`));

  if (defaultRules.length > 0) {
    await supabase.from("plan_feature_rules").insert(defaultRules);
  }
}

export async function ensureEntitlementSchema() {
  if (!schemaPromise) {
    schemaPromise = seedEntitlementData().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function builtInPlans(): PlanRow[] {
  return PLAN_DEFINITIONS.map((plan) => ({
    id: plan.id,
    name: plan.name,
    rank: plan.rank,
    description: plan.description,
  }));
}

function fallbackRule(planId: string, feature: FeatureRow | FeatureDefinition): RuleRow {
  const definition = FEATURE_DEFINITIONS.find((item) => item.key === feature.key);
  const defaultPlan = "defaultPlan" in feature ? feature.defaultPlan : feature.default_required_plan;
  return {
    plan_id: planId,
    feature_key: feature.key,
    enabled: planRank(planId) >= planRank(defaultPlan),
    quota: definition ? defaultQuotaFor(planId, definition) : null,
    reset_period_days: defaultResetPeriodFor(),
  };
}

function lowestEnabledPlan(featureKey: string, plans: PlanRow[], rules: RuleRow[]) {
  const enabledPlans = plans
    .filter((plan) => rules.some((rule) => rule.feature_key === featureKey && rule.plan_id === plan.id && rule.enabled))
    .sort((a, b) => a.rank - b.rank);
  return enabledPlans[0]?.id ?? "max";
}

async function getActivePlanId(userId: string): Promise<string> {
  const { data } = await supabase
    .from("user_subscriptions")
    .select("plan_id, status, current_period_end")
    .eq("user_id", userId)
    .in("status", ["active", "trialing"])
    .limit(1);

  const subscription = (data || [])[0] as { plan_id?: string; current_period_end?: string | null } | undefined;
  if (!subscription?.plan_id) return "free";
  if (subscription.current_period_end && new Date(subscription.current_period_end).getTime() < Date.now()) {
    return "free";
  }
  return subscription.plan_id;
}

export async function getEntitlements(userId: string, options: { includeUsage?: boolean } = {}): Promise<EntitlementSnapshot> {
  try {
    await ensureEntitlementSchema();
  } catch (err) {
    console.error("Entitlement schema unavailable; using built-in defaults:", err);
  }

  const plansResult = await supabase
    .from("subscription_plans")
    .select("id, name, rank, description")
    .order("rank", { ascending: true });
  const featuresResult = await supabase
    .from("feature_flags")
    .select("key, label, description, category, default_required_plan")
    .order("category", { ascending: true })
    .order("label", { ascending: true });
  const rulesResult = await supabase
    .from("plan_feature_rules")
    .select("plan_id, feature_key, enabled, quota, reset_period_days");

  const plans = ((plansResult.data || []) as PlanRow[]).length > 0
    ? (plansResult.data || []) as PlanRow[]
    : builtInPlans();
  const features = ((featuresResult.data || []) as FeatureRow[]).length > 0
    ? (featuresResult.data || []) as FeatureRow[]
    : FEATURE_DEFINITIONS.map((feature) => ({
      key: feature.key,
      label: feature.label,
      description: feature.description,
      category: feature.category,
      default_required_plan: feature.defaultPlan,
    }));
  const rules = (rulesResult.data || []) as RuleRow[];
  const activePlanId = await getActivePlanId(userId).catch(() => "free");
  const activePlan = plans.find((plan) => plan.id === activePlanId) ?? plans.find((plan) => plan.id === "free") ?? builtInPlans()[0];

  const featureAccess: FeatureAccess[] = features.map((feature) => {
    const planRule = rules.find((rule) => rule.plan_id === activePlan.id && rule.feature_key === feature.key)
      ?? fallbackRule(activePlan.id, feature);
    const featureRules = plans.map((plan) => (
      rules.find((rule) => rule.plan_id === plan.id && rule.feature_key === feature.key)
        ?? fallbackRule(plan.id, feature)
    ));

    return {
      key: feature.key,
      label: feature.label,
      description: feature.description || "",
      category: feature.category || "General",
      enabled: Boolean(planRule.enabled),
      quota: planRule.quota ?? null,
      resetPeriodDays: Math.max(0, Math.min(30, planRule.reset_period_days ?? 0)),
      usage: null,
      requiredPlan: lowestEnabledPlan(feature.key, plans, featureRules),
      defaultRequiredPlan: feature.default_required_plan,
    };
  });

  if (options.includeUsage) {
    await Promise.all(featureAccess.map(async (feature) => {
      if (!feature.enabled || feature.quota === null) return;
      try {
        feature.usage = await getCurrentUsage(userId, feature.key as FeatureKey, feature.resetPeriodDays);
      } catch (err) {
        console.error(`Usage lookup failed for ${feature.key}:`, err);
      }
    }));
  }

  return {
    plan: activePlan,
    plans,
    features: featureAccess,
    featureMap: Object.fromEntries(featureAccess.map((feature) => [feature.key, feature])),
  };
}

export class EntitlementError extends Error {
  status = 403;
  code: "FEATURE_NOT_INCLUDED" | "FEATURE_QUOTA_EXCEEDED";
  feature: FeatureAccess;
  plan: PlanRow;
  usage: number | null;

  constructor(code: "FEATURE_NOT_INCLUDED" | "FEATURE_QUOTA_EXCEEDED", feature: FeatureAccess, plan: PlanRow, usage: number | null = null) {
    const required = feature.requiredPlan === "free" ? "Free" : feature.requiredPlan.toUpperCase();
    super(code === "FEATURE_QUOTA_EXCEEDED"
      ? `${feature.label} limit reached for your ${plan.name} plan.`
      : `${feature.label} requires the ${required} plan.`);
    this.code = code;
    this.feature = feature;
    this.plan = plan;
    this.usage = usage;
  }
}

export async function getFeatureAccess(userId: string, key: FeatureKey) {
  const entitlements = await getEntitlements(userId);
  const feature = entitlements.featureMap[key];
  if (!feature) {
    const definition = FEATURE_DEFINITIONS.find((item) => item.key === key);
    if (!definition) throw new Error(`Unknown feature: ${key}`);
    return {
      feature: {
        key,
        label: definition.label,
        description: definition.description,
        category: definition.category,
        enabled: defaultEnabledFor(entitlements.plan.id, definition),
        quota: defaultQuotaFor(entitlements.plan.id, definition),
        resetPeriodDays: defaultResetPeriodFor(),
        usage: null,
        requiredPlan: definition.defaultPlan,
        defaultRequiredPlan: definition.defaultPlan,
      },
      plan: entitlements.plan,
    };
  }
  return { feature, plan: entitlements.plan };
}

export async function requireFeature(userId: string, key: FeatureKey) {
  const access = await getFeatureAccess(userId, key);
  if (!access.feature.enabled) {
    throw new EntitlementError("FEATURE_NOT_INCLUDED", access.feature, access.plan);
  }
  return access.feature;
}

export async function isFeatureEnabled(userId: string, key: FeatureKey) {
  try {
    const { feature } = await getFeatureAccess(userId, key);
    return feature.enabled;
  } catch {
    return false;
  }
}

// Lifetime quotas on "create"-style features are enforced against live row
// counts at their call sites (deleting a canvas frees quota), not usage events.
// Mirror that here so displayed usage matches what enforcement will do.
const LIVE_USAGE_COUNTERS: Partial<Record<FeatureKey, { table: string; ownerColumn: string; filters?: Record<string, string> }>> = {
  "canvas.create": { table: "canvases", ownerColumn: "user_id" },
  "project.create": { table: "canvas_projects", ownerColumn: "user_id" },
  "project.assets": { table: "project_assets", ownerColumn: "user_id" },
  "project.asset_links": { table: "project_asset_links", ownerColumn: "user_id" },
  "skills.create": { table: "skill_notes", ownerColumn: "owner_id" },
  "groups.create": { table: "user_groups", ownerColumn: "owner_id" },
  "skills.install_marketplace": { table: "skill_installations", ownerColumn: "user_id", filters: { status: "active" } },
  "skills.attach_canvas": { table: "skill_note_attachments", ownerColumn: "user_id", filters: { scope: "local" } },
  "skills.attach_global": { table: "skill_note_attachments", ownerColumn: "user_id", filters: { scope: "global" } },
};

async function getLiveUsageCount(userId: string, key: FeatureKey): Promise<number | null> {
  const counter = LIVE_USAGE_COUNTERS[key];
  if (!counter) return null;

  let query = supabase
    .from(counter.table)
    .select("id", { count: "exact", head: true })
    .eq(counter.ownerColumn, userId);
  for (const [column, value] of Object.entries(counter.filters ?? {})) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;
  if (error) {
    console.error(`Live usage count failed for ${key}:`, error);
    return null;
  }
  return count || 0;
}

async function getCurrentUsage(userId: string, key: FeatureKey, resetPeriodDays: number): Promise<number> {
  if (resetPeriodDays === 0) {
    const liveCount = await getLiveUsageCount(userId, key);
    if (liveCount !== null) return liveCount;
  }
  return getFeatureUsageCount(userId, key, resetPeriodDays);
}

export async function getFeatureUsageCount(userId: string, key: FeatureKey, resetPeriodDays: number) {
  await ensureEntitlementSchema();
  let query = supabase
    .from("feature_usage_events")
    .select("amount")
    .eq("user_id", userId)
    .eq("feature_key", key);

  if (resetPeriodDays > 0) {
    const windowStart = new Date(Date.now() - resetPeriodDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", windowStart);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Feature usage count failed:", error);
    return 0;
  }

  return ((data || []) as Array<{ amount?: number | null }>).reduce(
    (total, row) => total + Math.max(0, Number(row.amount || 0)),
    0,
  );
}

export async function requireFeatureQuota(userId: string, key: FeatureKey, usage?: number) {
  const access = await requireFeature(userId, key);
  if (access.quota !== null) {
    const effectiveUsage = access.resetPeriodDays > 0 || usage === undefined
      ? await getFeatureUsageCount(userId, key, access.resetPeriodDays)
      : usage;

    if (effectiveUsage >= access.quota) {
      const snapshot = await getEntitlements(userId);
      throw new EntitlementError("FEATURE_QUOTA_EXCEEDED", access, snapshot.plan, effectiveUsage);
    }
  }
  return access;
}

export async function recordFeatureUsage(userId: string, key: FeatureKey, amount = 1, metadata: Record<string, unknown> = {}) {
  const normalizedAmount = Math.max(1, Math.floor(Number(amount) || 1));
  try {
    await ensureEntitlementSchema();
    const { error } = await supabase
      .from("feature_usage_events")
      .insert({
        user_id: userId,
        feature_key: key,
        amount: normalizedAmount,
        metadata,
      });
    if (error) console.error("Feature usage record failed:", error);
  } catch (err) {
    console.error("Feature usage record failed:", err);
  }
}

export function sendEntitlementError(res: VercelResponse, err: EntitlementError) {
  return res.status(err.status).json({
    error: err.message,
    code: err.code,
    featureKey: err.feature.key,
    featureLabel: err.feature.label,
    planId: err.plan.id,
    requiredPlan: err.feature.requiredPlan,
    quota: err.feature.quota,
    resetPeriodDays: err.feature.resetPeriodDays,
    usage: err.usage,
  });
}

export function isEntitlementError(err: unknown): err is EntitlementError {
  return err instanceof EntitlementError;
}
