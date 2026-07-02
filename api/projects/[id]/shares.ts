import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import {
  getCollaborationRole,
  getDefaultRoleForAccess,
  legacyAccessForCapabilities,
  type LegacyShareAccessLevel,
} from "../../lib/collaboration-roles.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../../lib/entitlements.js";
import { getProjectAccess, hasCapability } from "../../lib/project-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query.id as string;
  if (!projectId) return res.status(400).json({ error: "Project ID is required" });

  const access = await getProjectAccess(projectId, auth.userId);
  if (!access) return res.status(404).json({ error: "Project not found" });
  if (!hasCapability(access, "project.manage_shares")) {
    return res.status(403).json({ error: "You do not have permission to manage collaboration" });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("project_shares")
      .select("id, project_id, shared_with_group_id, access_level, role_id, created_at, user_groups(name), collaboration_roles(id, name, description, is_system_role)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message || "Failed to load project shares" });
    return res.status(200).json({ shares: data || [] });
  }

  if (req.method === "POST") {
    const { groupId, roleId, accessLevel } = req.body || {};
    const normalizedAccess: LegacyShareAccessLevel = accessLevel === "edit" ? "edit" : "view";
    if (!groupId) return res.status(400).json({ error: "groupId is required" });

    try {
      await requireFeatureQuota(auth.userId, "project.share_groups");
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Project share entitlement check failed:", err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }

    const { data: group } = await supabase
      .from("user_groups")
      .select("id")
      .eq("id", groupId)
      .eq("owner_id", access.ownerUserId)
      .single();
    if (!group) return res.status(400).json({ error: "Group not found" });

    let resolvedRoleId: string | null = null;
    let resolvedAccess = normalizedAccess;
    if (roleId) {
      const role = await getCollaborationRole(String(roleId));
      if (!role) return res.status(400).json({ error: "Role not found" });
      resolvedRoleId = role.id;
      resolvedAccess = legacyAccessForCapabilities(role.capabilities);
    } else {
      const role = await getDefaultRoleForAccess(normalizedAccess);
      resolvedRoleId = role?.id ?? null;
    }

    const { data, error } = await supabase
      .from("project_shares")
      .upsert({
        project_id: projectId,
        shared_by: auth.userId,
        shared_with_group_id: groupId,
        access_level: resolvedAccess,
        role_id: resolvedRoleId,
      }, { onConflict: "project_id,shared_with_group_id" })
      .select("id, project_id, shared_with_group_id, access_level, role_id, created_at, user_groups(name), collaboration_roles(id, name, description, is_system_role)")
      .single();

    if (error) return res.status(500).json({ error: error.message || "Failed to share project" });
    await recordFeatureUsage(auth.userId, "project.share_groups", 1, {
      projectId,
      groupId,
    });
    return res.status(201).json({ share: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
