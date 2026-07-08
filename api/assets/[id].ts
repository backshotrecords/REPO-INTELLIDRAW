import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { isEntitlementError, requireFeature, sendEntitlementError } from "../lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing asset id" });

  // PUT = rename / update markdown body
  if (req.method === "PUT") {
    try {
      await requireFeature(auth.userId, "project.assets");

      const { name, markdown } = req.body || {};
      const updates: Record<string, unknown> = {};

      if (name !== undefined) {
        if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Invalid name" });
        updates.name = name.trim().slice(0, 80);
      }
      if (markdown !== undefined) {
        if (typeof markdown !== "string") return res.status(400).json({ error: "Invalid markdown" });
        updates.markdown = markdown.slice(0, 100_000);
      }
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updates provided" });
      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabase.from("project_assets")
        .update(updates).eq("id", id).eq("user_id", auth.userId).select("*").single();
      if (error || !data) return res.status(404).json({ error: "Asset not found" });
      return res.json({ asset: data });
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Update project asset error:", err);
      return res.status(500).json({ error: "Failed to update asset" });
    }
  }

  // DELETE = remove asset (links cascade)
  if (req.method === "DELETE") {
    const { error } = await supabase.from("project_assets").delete()
      .eq("id", id).eq("user_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to delete asset" });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
