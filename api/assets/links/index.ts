import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // POST = link an asset to a canvas node
  if (req.method === "POST") {
    const { asset_id, canvas_id, node_id } = req.body || {};
    if (!asset_id || !canvas_id || !node_id || typeof node_id !== "string") {
      return res.status(400).json({ error: "asset_id, canvas_id, node_id required" });
    }

    const { data: asset } = await supabase.from("project_assets")
      .select("id").eq("id", asset_id).eq("user_id", auth.userId).single();
    if (!asset) return res.status(404).json({ error: "Asset not found" });

    const { data, error } = await supabase.from("project_asset_links")
      .insert({
        asset_id,
        user_id: auth.userId,
        canvas_id,
        node_id: node_id.slice(0, 200),
        status: "active",
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Already linked" });
      if (error.code === "23503") return res.status(404).json({ error: "Canvas not found" });
      return res.status(500).json({ error: error.message || "Failed to create link" });
    }

    return res.status(201).json({ link: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
