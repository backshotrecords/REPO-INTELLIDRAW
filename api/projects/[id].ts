import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  assertProjectOwned,
  getProjectAndDescendantIds,
  normalizeProjectAccent,
  normalizeProjectId,
  touchProjectAncestors,
} from "../lib/canvas-projects.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;
  const projectId = req.query.id as string;

  if (!projectId) {
    return res.status(400).json({ error: "Project ID is required" });
  }

  const existingProject = await assertProjectOwned(projectId, userId);
  if (!existingProject) {
    return res.status(404).json({ error: "Project not found" });
  }

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("canvas_projects")
        .select("id, user_id, parent_project_id, title, description, accent, manually_archived, created_at, updated_at")
        .eq("id", projectId)
        .eq("user_id", userId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Project not found" });
      }

      return res.status(200).json({ project: data });
    } catch (err) {
      console.error("Get project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "PUT") {
    const { title, description, accent, parentProjectId, manuallyArchived } = req.body || {};
    const requestedParentId = normalizeProjectId(parentProjectId);
    const hasRealChange =
      title !== undefined ||
      description !== undefined ||
      accent !== undefined ||
      parentProjectId !== undefined;

    try {
      if (requestedParentId) {
        if (!(await assertProjectOwned(requestedParentId, userId))) {
          return res.status(400).json({ error: "Destination project not found" });
        }

        const blockedIds = await getProjectAndDescendantIds(projectId, userId);
        if (blockedIds.has(requestedParentId)) {
          return res.status(400).json({ error: "Cannot move a project into itself or a child project" });
        }
      }

      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {};

      if (title !== undefined) updateData.title = String(title || "Untitled Project").slice(0, 80);
      if (description !== undefined) updateData.description = String(description || "").slice(0, 240);
      if (accent !== undefined) updateData.accent = normalizeProjectAccent(accent);
      if (parentProjectId !== undefined) updateData.parent_project_id = requestedParentId;

      if (hasRealChange) {
        updateData.updated_at = now;
        updateData.manually_archived = false;
      } else if (manuallyArchived !== undefined) {
        updateData.manually_archived = Boolean(manuallyArchived);
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No project updates provided" });
      }

      const { data, error } = await supabase
        .from("canvas_projects")
        .update(updateData)
        .eq("id", projectId)
        .eq("user_id", userId)
        .select("id, user_id, parent_project_id, title, description, accent, manually_archived, created_at, updated_at")
        .single();

      if (error || !data) {
        console.error("Update project error:", error);
        return res.status(404).json({ error: "Project not found or update failed" });
      }

      if (hasRealChange) {
        await touchProjectAncestors(existingProject.parent_project_id, userId, now);
        if (requestedParentId !== existingProject.parent_project_id) {
          await touchProjectAncestors(requestedParentId, userId, now);
        }
      }

      return res.status(200).json({ project: data });
    } catch (err) {
      console.error("Update project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { error } = await supabase
        .from("canvas_projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", userId);

      if (error) {
        console.error("Delete project error:", error);
        return res.status(500).json({ error: "Failed to delete project" });
      }

      await touchProjectAncestors(existingProject.parent_project_id, userId);

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Delete project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
