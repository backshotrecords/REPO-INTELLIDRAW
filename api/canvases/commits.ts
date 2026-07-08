import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { getCanvasAccess, hasCapability } from "../lib/project-access.js";
import { broadcastCanvasEvent } from "../lib/realtime-broadcast.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/canvases/commits?canvasId=xxx — List all commits for a canvas
  if (req.method === "GET") {
    const canvasId = req.query.canvasId as string;
    if (!canvasId) {
      return res.status(400).json({ error: "canvasId query parameter is required" });
    }

    try {
      const access = await getCanvasAccess(canvasId, userId);
      if (!access) return res.status(404).json({ error: "Canvas not found" });

      // Fetch commits ordered by creation time
      const { data, error } = await supabase
        .from("canvas_commits")
        .select("*")
        .eq("canvas_id", canvasId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Fetch commits error:", error);
        return res.status(500).json({ error: "Failed to fetch commits" });
      }

      return res.status(200).json({ commits: data || [] });
    } catch (err) {
      console.error("List commits error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // POST /api/canvases/commits — Create a new commit
  if (req.method === "POST") {
    const { canvasId, mermaidCode, source, commitMessage, senderClientId } = req.body || {};

    if (!canvasId || !mermaidCode) {
      return res.status(400).json({ error: "canvasId and mermaidCode are required" });
    }

    try {
      const access = await getCanvasAccess(canvasId, userId);
      if (!access) return res.status(404).json({ error: "Canvas not found" });
      if (!hasCapability(access, "canvas.commit")) {
        return res.status(403).json({ error: "You do not have permission to commit this canvas" });
      }

      // Insert the commit
      const { data, error } = await supabase
        .from("canvas_commits")
        .insert({
          canvas_id: canvasId,
          mermaid_code: mermaidCode,
          source: source || "ai_chat",
          commit_message: commitMessage || "",
        })
        .select("*")
        .single();

      if (error) {
        console.error("Create commit error:", error);
        return res.status(500).json({ error: "Failed to create commit" });
      }

      await broadcastCanvasEvent(canvasId, "commit", senderClientId);

      return res.status(201).json({ commit: data });
    } catch (err) {
      console.error("Create commit error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
