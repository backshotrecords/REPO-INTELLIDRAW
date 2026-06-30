import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../../lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing group id" });

  // Verify ownership
  const { data: group } = await supabase.from("user_groups").select("id").eq("id", id).eq("owner_id", auth.userId).single();
  if (!group) return res.status(403).json({ error: "Not the group owner" });

  // POST = add member, DELETE = remove member
  if (req.method === "POST") {
    try {
      await requireFeatureQuota(auth.userId, "groups.manage_members");
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Group entitlement check failed:", err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email is required" });

    const { data: targetUser } = await supabase.from("users").select("id, display_name, email")
      .eq("email", (email as string).toLowerCase()).single();
    if (!targetUser) return res.status(404).json({ error: "User not found" });

    const { data, error } = await supabase.from("group_members")
      .insert({ group_id: id, user_id: targetUser.id }).select("*").single();

    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Already a member" });
      return res.status(500).json({ error: error.message || "Failed to add member" });
    }

    await recordFeatureUsage(auth.userId, "groups.manage_members", 1, {
      action: "add_member",
      groupId: id,
    });

    return res.status(201).json({ member: { ...data, display_name: targetUser.display_name, email: targetUser.email } });
  }

  if (req.method === "DELETE") {
    try {
      await requireFeatureQuota(auth.userId, "groups.manage_members");
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Group entitlement check failed:", err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    const { error } = await supabase.from("group_members").delete()
      .eq("group_id", id).eq("user_id", userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to remove member" });
    await recordFeatureUsage(auth.userId, "groups.manage_members", 1, {
      action: "remove_member",
      groupId: id,
    });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
