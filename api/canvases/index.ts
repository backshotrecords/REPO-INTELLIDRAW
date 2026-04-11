import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/canvases — List all canvases for the user
  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("canvases")
        .select("id, title, mermaid_code, created_at, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("List canvases error:", error);
        return res.status(500).json({ error: "Failed to fetch canvases" });
      }

      return res.status(200).json({ canvases: data || [] });
    } catch (err) {
      console.error("List canvases error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // POST /api/canvases — Create a new canvas
  if (req.method === "POST") {
    const { title, mermaidCode } = req.body || {};

    try {
      const { data, error } = await supabase
        .from("canvases")
        .insert({
          user_id: userId,
          title: title || "Untitled Canvas",
          mermaid_code: mermaidCode || "flowchart TD\n    A[Start] --> B[Next Step]",
          chat_history: [],
        })
        .select("id, title, mermaid_code, chat_history, created_at, updated_at")
        .single();

      if (error) {
        console.error("Create canvas error:", error);
        return res.status(500).json({ error: "Failed to create canvas" });
      }

      return res.status(201).json({ canvas: data });
    } catch (err) {
      console.error("Create canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
