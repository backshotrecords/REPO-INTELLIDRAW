import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { ensureEntitlementSchema, getEntitlements } from "../lib/entitlements.js";

async function isGlobalAdmin(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("is_global_admin")
    .eq("id", userId)
    .single();

  return Boolean(data?.is_global_admin);
}

async function buildMatrix() {
  await ensureEntitlementSchema();

  const snapshot = await getEntitlements("00000000-0000-0000-0000-000000000000");
  const { data: rules } = await supabase
    .from("plan_feature_rules")
    .select("plan_id, feature_key, enabled, quota");

  const rulesByFeature = new Map<string, Record<string, { enabled: boolean; quota: number | null }>>();
  for (const rule of (rules || []) as Array<{ plan_id: string; feature_key: string; enabled: boolean; quota: number | null }>) {
    const featureRules = rulesByFeature.get(rule.feature_key) ?? {};
    featureRules[rule.plan_id] = { enabled: Boolean(rule.enabled), quota: rule.quota ?? null };
    rulesByFeature.set(rule.feature_key, featureRules);
  }

  return {
    plans: snapshot.plans,
    features: snapshot.features.map((feature) => ({
      key: feature.key,
      label: feature.label,
      description: feature.description,
      category: feature.category,
      defaultRequiredPlan: feature.defaultRequiredPlan,
      requiredPlan: feature.requiredPlan,
      rules: rulesByFeature.get(feature.key) ?? {},
    })),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (!(await isGlobalAdmin(auth.userId))) return res.status(403).json({ error: "Forbidden: Admins only" });

  if (req.method === "GET") {
    try {
      return res.status(200).json(await buildMatrix());
    } catch (err) {
      console.error("Admin features GET error:", err);
      return res.status(500).json({ error: "Failed to load feature matrix" });
    }
  }

  if (req.method === "PUT") {
    const { planId, featureKey, enabled, quota } = req.body || {};
    if (!planId || !featureKey || typeof enabled !== "boolean") {
      return res.status(400).json({ error: "planId, featureKey, and enabled are required" });
    }

    const normalizedQuota = quota === null || quota === undefined || quota === ""
      ? null
      : Math.max(0, parseInt(String(quota), 10));

    try {
      await ensureEntitlementSchema();
      const { error } = await supabase
        .from("plan_feature_rules")
        .upsert({
          plan_id: String(planId),
          feature_key: String(featureKey),
          enabled,
          quota: Number.isFinite(normalizedQuota) ? normalizedQuota : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "plan_id,feature_key" });

      if (error) return res.status(400).json({ error: error.message || "Failed to save feature rule" });
      return res.status(200).json(await buildMatrix());
    } catch (err) {
      console.error("Admin features PUT error:", err);
      return res.status(500).json({ error: "Failed to save feature rule" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
