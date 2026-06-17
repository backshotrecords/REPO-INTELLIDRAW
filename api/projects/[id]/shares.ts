import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { canOwn, getProjectAccess } from "../../lib/project-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query.id as string;
  if (!projectId) return res.status(400).json({ error: "Project ID is required" });

  const access = await getProjectAccess(projectId, auth.userId);
  if (!access) return res.status(404).json({ error: "Project not found" });
  if (!canOwn(access)) return res.status(403).json({ error: "Only the project owner can manage collaboration" });

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("project_shares")
      .select("id, project_id, shared_with_group_id, access_level, created_at, user_groups(name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error: error.message || "Failed to load project shares" });
    return res.status(200).json({ shares: data || [] });
  }

  if (req.method === "POST") {
    const { groupId, accessLevel } = req.body || {};
    const normalizedAccess = accessLevel === "edit" ? "edit" : "view";
    if (!groupId) return res.status(400).json({ error: "groupId is required" });

    const { data: group } = await supabase
      .from("user_groups")
      .select("id")
      .eq("id", groupId)
      .eq("owner_id", auth.userId)
      .single();
    if (!group) return res.status(400).json({ error: "Group not found" });

    const { data, error } = await supabase
      .from("project_shares")
      .upsert({
        project_id: projectId,
        shared_by: auth.userId,
        shared_with_group_id: groupId,
        access_level: normalizedAccess,
      }, { onConflict: "project_id,shared_with_group_id" })
      .select("id, project_id, shared_with_group_id, access_level, created_at, user_groups(name)")
      .single();

    if (error) return res.status(500).json({ error: error.message || "Failed to share project" });
    return res.status(201).json({ share: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

