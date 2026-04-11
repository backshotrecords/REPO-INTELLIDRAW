import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;
  const canvasId = req.query.id as string;

  if (!canvasId) {
    return res.status(400).json({ error: "Canvas ID is required" });
  }

  // GET /api/canvases/[id] — Get a single canvas
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("canvases")
        .select("*")
        .eq("id", canvasId)
        .eq("user_id", userId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Canvas not found" });
      }

      return res.status(200).json({ canvas: data });
    } catch (err) {
      console.error("Get canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // PUT /api/canvases/[id] — Update a canvas
  if (req.method === "PUT") {
    const { title, mermaidCode, chatHistory } = req.body || {};

    try {
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined) updateData.title = title;
      if (mermaidCode !== undefined) updateData.mermaid_code = mermaidCode;
      if (chatHistory !== undefined) updateData.chat_history = chatHistory;

      const { data, error } = await supabase
        .from("canvases")
        .update(updateData)
        .eq("id", canvasId)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Canvas not found or update failed" });
      }

      return res.status(200).json({ canvas: data });
    } catch (err) {
      console.error("Update canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // DELETE /api/canvases/[id] — Delete a canvas
  if (req.method === "DELETE") {
    try {
      const { error } = await supabase
        .from("canvases")
        .delete()
        .eq("id", canvasId)
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: "Failed to delete canvas" });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Delete canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
