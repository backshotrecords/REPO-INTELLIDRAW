import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { assertProjectOwned, normalizeProjectId, touchProjectAncestors } from "../lib/canvas-projects.js";
import {
  recalculateGlobalSkillStarsForUser,
  recalculateSkillStarsForAttachments,
} from "../lib/skill-stars.js";

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
    const { title, mermaidCode, chatHistory, isPublic, projectId, manuallyArchived } = req.body || {};

    try {
      const { data: existingCanvas, error: existingError } = await supabase
        .from("canvases")
        .select("id, project_id")
        .eq("id", canvasId)
        .eq("user_id", userId)
        .single();

      if (existingError || !existingCanvas) {
        return res.status(404).json({ error: "Canvas not found" });
      }

      const nextProjectId = normalizeProjectId(projectId);
      if (nextProjectId && !(await assertProjectOwned(nextProjectId, userId))) {
        return res.status(400).json({ error: "Project not found" });
      }

      const hasRealChange =
        title !== undefined ||
        mermaidCode !== undefined ||
        chatHistory !== undefined ||
        isPublic !== undefined ||
        projectId !== undefined;
      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {};

      if (title !== undefined) updateData.title = String(title).slice(0, 80);
      if (mermaidCode !== undefined) updateData.mermaid_code = mermaidCode;
      if (chatHistory !== undefined) updateData.chat_history = chatHistory;
      if (isPublic !== undefined) updateData.is_public = isPublic;
      if (projectId !== undefined) updateData.project_id = nextProjectId;

      if (hasRealChange) {
        updateData.updated_at = now;
        updateData.manually_archived = false;
      } else if (manuallyArchived !== undefined) {
        updateData.manually_archived = Boolean(manuallyArchived);
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No canvas updates provided" });
      }

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

      if (hasRealChange) {
        const previousProjectId = (existingCanvas as { project_id?: string | null }).project_id;
        await touchProjectAncestors(previousProjectId, userId, now);
        if (nextProjectId !== previousProjectId) await touchProjectAncestors(nextProjectId, userId, now);
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
      const { data: localAttachments } = await supabase
        .from("skill_note_attachments")
        .select("skill_note_id")
        .eq("canvas_id", canvasId)
        .eq("user_id", userId);

      const { error } = await supabase
        .from("canvases")
        .delete()
        .eq("id", canvasId)
        .eq("user_id", userId);

      if (error) {
        return res.status(500).json({ error: "Failed to delete canvas" });
      }

      await recalculateSkillStarsForAttachments((localAttachments || []) as Array<{ skill_note_id: string }>);
      await recalculateGlobalSkillStarsForUser(userId);

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Delete canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
