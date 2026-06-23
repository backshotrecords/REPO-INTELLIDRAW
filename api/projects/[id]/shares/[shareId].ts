import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import { supabase } from "../../../lib/db.js";
import {
  getCollaborationRole,
  getDefaultRoleForAccess,
  legacyAccessForCapabilities,
  type LegacyShareAccessLevel,
} from "../../../lib/collaboration-roles.js";
import { getProjectAccess, hasCapability } from "../../../lib/project-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query.id as string;
  const shareId = req.query.shareId as string;
  if (!projectId || !shareId) return res.status(400).json({ error: "Project and share IDs are required" });

  const access = await getProjectAccess(projectId, auth.userId);
  if (!access) return res.status(404).json({ error: "Project not found" });
  if (!hasCapability(access, "project.manage_shares")) {
    return res.status(403).json({ error: "You do not have permission to manage collaboration" });
  }

  if (req.method === "PUT") {
    const normalizedAccess: LegacyShareAccessLevel = req.body?.accessLevel === "edit" ? "edit" : "view";
    const roleId = req.body?.roleId;
    let resolvedRoleId: string | null = null;
    let accessLevel = normalizedAccess;

    if (roleId) {
      const role = await getCollaborationRole(String(roleId));
      if (!role) return res.status(400).json({ error: "Role not found" });
      resolvedRoleId = role.id;
      accessLevel = legacyAccessForCapabilities(role.capabilities);
    } else {
      const role = await getDefaultRoleForAccess(normalizedAccess);
      resolvedRoleId = role?.id ?? null;
    }

    const { data, error } = await supabase
      .from("project_shares")
      .update({ access_level: accessLevel, role_id: resolvedRoleId })
      .eq("id", shareId)
      .eq("project_id", projectId)
      .select("id, project_id, shared_with_group_id, access_level, role_id, created_at, user_groups(name), collaboration_roles(id, name, description, is_system_role)")
      .single();

    if (error || !data) return res.status(404).json({ error: "Share not found" });
    return res.status(200).json({ share: data });
  }

  if (req.method === "DELETE") {
    const { error } = await supabase
      .from("project_shares")
      .delete()
      .eq("id", shareId)
      .eq("project_id", projectId);

    if (error) return res.status(500).json({ error: error.message || "Failed to remove project share" });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
