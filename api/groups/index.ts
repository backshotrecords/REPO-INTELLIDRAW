import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET = list groups, POST = create group
  if (req.method === "GET") {
    // Groups I own
    const { data: ownedGroups } = await supabase.from("user_groups").select("*").eq("owner_id", auth.userId);

    // Groups I'm a member of
    const { data: memberships } = await supabase.from("group_members").select("group_id").eq("user_id", auth.userId);
    const memberGroupIds = (memberships || []).map((m: Record<string, unknown>) => m.group_id as string);
    let memberGroups: Record<string, unknown>[] = [];
    if (memberGroupIds.length > 0) {
      const { data } = await supabase.from("user_groups").select("*").in("id", memberGroupIds);
      memberGroups = (data as Record<string, unknown>[]) || [];
    }

    const allGroupIds = [...new Set([...(ownedGroups || []).map((g: Record<string, unknown>) => g.id as string), ...memberGroupIds])];
    const allGroups = [...(ownedGroups || []), ...memberGroups.filter((g: Record<string, unknown>) =>
      !(ownedGroups || []).some((og: Record<string, unknown>) => og.id === g.id))];

    // Fetch members for all groups
    let allMembers: Record<string, unknown>[] = [];
    if (allGroupIds.length > 0) {
      const { data } = await supabase.from("group_members")
        .select("*, users(display_name, email)")
        .in("group_id", allGroupIds);
      allMembers = (data as Record<string, unknown>[]) || [];
    }

    const groupsWithMembers = allGroups.map((g: Record<string, unknown>) => {
      const members = allMembers.filter((m: Record<string, unknown>) => m.group_id === g.id)
        .map((m: Record<string, unknown>) => {
          const u = m.users as Record<string, unknown> | null;
          return { ...m, display_name: u?.display_name, email: u?.email, users: undefined };
        });
      return { ...g, members, member_count: members.length };
    });

    return res.json({ groups: groupsWithMembers });
  }

  if (req.method === "POST") {
    const { name } = req.body || {};
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) return res.status(400).json({ error: "Group name is required" });
    if (trimmedName.length > 80) return res.status(400).json({ error: "Group name must be 80 characters or fewer" });
    try {
      const { count } = await supabase
        .from("user_groups")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", auth.userId);
      await requireFeatureQuota(auth.userId, "groups.create", count || 0);
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Group entitlement check failed:", err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
    const { data, error } = await supabase.from("user_groups").insert({ name: trimmedName, owner_id: auth.userId }).select("*").single();
    if (error) return res.status(500).json({ error: error.message || "Failed to create group" });
    await recordFeatureUsage(auth.userId, "groups.create", 1, {
      groupId: data.id,
    });
    return res.status(201).json({ group: { ...data, members: [], member_count: 0 } });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
