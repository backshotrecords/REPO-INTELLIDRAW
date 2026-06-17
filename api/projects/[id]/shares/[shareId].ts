import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import { supabase } from "../../../lib/db.js";
import { canOwn, getProjectAccess } from "../../../lib/project-access.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const projectId = req.query.id as string;
  const shareId = req.query.shareId as string;
  if (!projectId || !shareId) return res.status(400).json({ error: "Project and share IDs are required" });

  const access = await getProjectAccess(projectId, auth.userId);
  if (!access) return res.status(404).json({ error: "Project not found" });
  if (!canOwn(access)) return res.status(403).json({ error: "Only the project owner can manage collaboration" });

  if (req.method === "PUT") {
    const accessLevel = req.body?.accessLevel === "edit" ? "edit" : "view";
    const { data, error } = await supabase
      .from("project_shares")
      .update({ access_level: accessLevel })
      .eq("id", shareId)
      .eq("project_id", projectId)
      .select("id, project_id, shared_with_group_id, access_level, created_at, user_groups(name)")
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

