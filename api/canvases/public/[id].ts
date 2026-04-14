import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../../lib/db.js";

/**
 * Public (unauthenticated) endpoint to view a published canvas.
 * GET /api/canvases/public/[id]
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const canvasId = req.query.id as string;
  if (!canvasId) {
    return res.status(400).json({ error: "Canvas ID is required" });
  }

  try {
    const { data, error } = await supabase
      .from("canvases")
      .select("id, title, mermaid_code, is_public, updated_at, created_at")
      .eq("id", canvasId)
      .eq("is_public", true)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Canvas not found or not public" });
    }

    return res.status(200).json({ canvas: data });
  } catch (err) {
    console.error("Public canvas fetch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
