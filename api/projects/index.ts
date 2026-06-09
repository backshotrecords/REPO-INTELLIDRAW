import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  assertProjectOwned,
  normalizeProjectAccent,
  normalizeProjectId,
  PROJECT_SELECT,
  touchProjectAncestors,
} from "../lib/canvas-projects.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("canvas_projects")
        .select(PROJECT_SELECT)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("List projects error:", error);
        return res.status(500).json({ error: "Failed to fetch projects" });
      }

      return res.status(200).json({ projects: data || [] });
    } catch (err) {
      console.error("List projects error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "POST") {
    const { title, description, accent, parentProjectId } = req.body || {};
    const parentId = normalizeProjectId(parentProjectId);

    try {
      if (parentId && !(await assertProjectOwned(parentId, userId))) {
        return res.status(400).json({ error: "Parent project not found" });
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("canvas_projects")
        .insert({
          user_id: userId,
          parent_project_id: parentId ?? null,
          title: String(title || "Untitled Project").slice(0, 80),
          description: String(description || "").slice(0, 240),
          accent: normalizeProjectAccent(accent),
          manually_archived: false,
          updated_at: now,
        })
        .select(PROJECT_SELECT)
        .single();

      if (error || !data) {
        console.error("Create project error:", error);
        return res.status(500).json({ error: "Failed to create project" });
      }

      if (parentId) await touchProjectAncestors(parentId, userId, now);

      return res.status(201).json({ project: data });
    } catch (err) {
      console.error("Create project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
