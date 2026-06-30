import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing group id" });

  // PUT = update group name
  if (req.method === "PUT") {
    try {
      await requireFeatureQuota(auth.userId, "groups.manage_members");
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Group entitlement check failed:", err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
    const { name } = req.body || {};
    const { data, error } = await supabase.from("user_groups").update({ name })
      .eq("id", id).eq("owner_id", auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Group not found" });
    await recordFeatureUsage(auth.userId, "groups.manage_members", 1, {
      action: "update_group",
      groupId: id,
    });
    return res.json({ group: data });
  }

  // DELETE = delete group
  if (req.method === "DELETE") {
    try {
      await requireFeatureQuota(auth.userId, "groups.manage_members");
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Group entitlement check failed:", err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
    const { error } = await supabase.from("user_groups").delete()
      .eq("id", id).eq("owner_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to delete group" });
    await recordFeatureUsage(auth.userId, "groups.manage_members", 1, {
      action: "delete_group",
      groupId: id,
    });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
