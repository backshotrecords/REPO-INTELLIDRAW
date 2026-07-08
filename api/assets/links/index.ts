import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import {
  isEntitlementError,
  recordFeatureUsage,
  requireFeatureQuota,
  sendEntitlementError,
} from "../../lib/entitlements.js";

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

    try {
      const { count } = await supabase
        .from("project_asset_links")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.userId);
      await requireFeatureQuota(auth.userId, "project.asset_links", count || 0);
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Project asset link quota check error:", err);
      return res.status(500).json({ error: "Failed to check asset link quota" });
    }

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

    await recordFeatureUsage(auth.userId, "project.asset_links", 1, {
      assetId: asset_id,
      canvasId: canvas_id,
    });

    return res.status(201).json({ link: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
