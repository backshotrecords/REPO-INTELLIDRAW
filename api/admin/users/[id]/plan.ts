import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import { supabase } from "../../../lib/db.js";
import { ensureEntitlementSchema } from "../../../lib/entitlements.js";

async function isGlobalAdmin(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("is_global_admin")
    .eq("id", userId)
    .single();

  return Boolean(data?.is_global_admin);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (!(await isGlobalAdmin(auth.userId))) return res.status(403).json({ error: "Forbidden: Admins only" });
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing user id" });

  const { planId, status } = req.body || {};
  if (!planId) return res.status(400).json({ error: "planId is required" });

  try {
    await ensureEntitlementSchema();
    const { data: plan } = await supabase
      .from("subscription_plans")
      .select("id, name, rank")
      .eq("id", String(planId))
      .single();
    if (!plan) return res.status(400).json({ error: "Unknown plan" });

    const { data, error } = await supabase
      .from("user_subscriptions")
      .upsert({
        user_id: id,
        plan_id: plan.id,
        status: status === "trialing" ? "trialing" : "active",
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message || "Failed to update plan" });
    return res.status(200).json({ subscription: data, plan });
  } catch (err) {
    console.error("Admin user plan API error:", err);
    return res.status(500).json({ error: "Failed to update user plan" });
  }
}
