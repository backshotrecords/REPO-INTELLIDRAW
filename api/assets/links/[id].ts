import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

const VALID_STATUSES = new Set(["active", "pending"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing link id" });

  // PUT = update link status
  if (req.method === "PUT") {
    const { status } = req.body || {};
    if (!status || !VALID_STATUSES.has(status)) return res.status(400).json({ error: "Invalid status" });

    const { data, error } = await supabase.from("project_asset_links")
      .update({ status }).eq("id", id).eq("user_id", auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Link not found" });
    return res.json({ link: data });
  }

  // DELETE = unlink
  if (req.method === "DELETE") {
    const { error } = await supabase.from("project_asset_links").delete()
      .eq("id", id).eq("user_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to remove link" });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
