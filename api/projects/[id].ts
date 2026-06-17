import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  getProjectAndDescendantIds,
  normalizeProjectAccent,
  normalizeProjectId,
  PROJECT_SELECT,
  touchProjectAncestors,
} from "../lib/canvas-projects.js";
import { deleteCanvasesInProjectsForUser } from "../lib/canvas-lifecycle.js";
import { canEdit, canOwn, getProjectAccess, withAccessMetadata } from "../lib/project-access.js";

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

  const access = await getProjectAccess(projectId, userId);
  if (!access) {
    return res.status(404).json({ error: "Project not found" });
  }

  if (req.method === "GET") {
    try {
      const { data, error } = await supabase
        .from("canvas_projects")
        .select(PROJECT_SELECT)
        .eq("id", projectId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Project not found" });
      }

      return res.status(200).json({ project: withAccessMetadata(data as Record<string, unknown>, access) });
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
      if (!canEdit(access)) {
        return res.status(403).json({ error: "You do not have permission to edit this project" });
      }

      if ((parentProjectId !== undefined || manuallyArchived !== undefined) && !canOwn(access)) {
        return res.status(403).json({ error: "Only the project owner can move or archive this project" });
      }

      if (requestedParentId) {
        const parentAccess = await getProjectAccess(requestedParentId, userId);
        if (!parentAccess || !canOwn(parentAccess)) {
          return res.status(400).json({ error: "Destination project not found" });
        }

        const blockedIds = await getProjectAndDescendantIds(projectId, access.ownerUserId);
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
        .select(PROJECT_SELECT)
        .single();

      if (error || !data) {
        console.error("Update project error:", error);
        return res.status(404).json({ error: "Project not found or update failed" });
      }

      if (hasRealChange) {
        await touchProjectAncestors(access.project.parent_project_id as string | null, access.ownerUserId, now);
        if (requestedParentId !== access.project.parent_project_id) {
          await touchProjectAncestors(requestedParentId, access.ownerUserId, now);
        }
      }

      return res.status(200).json({ project: withAccessMetadata(data as Record<string, unknown>, access) });
    } catch (err) {
      console.error("Update project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "DELETE") {
    try {
      if (!canOwn(access)) {
        return res.status(403).json({ error: "Only the project owner can delete this project" });
      }

      const projectIdsToDelete = await getProjectAndDescendantIds(projectId, userId);
      const canvasDeletion = await deleteCanvasesInProjectsForUser({
        projectIds: [...projectIdsToDelete],
        userId,
      });

      const { error } = await supabase
        .from("canvas_projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", userId);

      if (error) {
        console.error("Delete project error:", error);
        return res.status(500).json({ error: "Failed to delete project" });
      }

      await touchProjectAncestors(access.project.parent_project_id as string | null, userId);

      return res.status(200).json({ success: true, deletedProjectIds: [...projectIdsToDelete], ...canvasDeletion });
    } catch (err) {
      console.error("Delete project error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
