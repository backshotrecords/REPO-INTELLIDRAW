import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { normalizeProjectId, touchProjectAncestors } from "../lib/canvas-projects.js";
import { deleteCanvasForUser } from "../lib/canvas-lifecycle.js";
import { isEntitlementError, requireFeature, sendEntitlementError } from "../lib/entitlements.js";
import { canOwn, getCanvasAccess, getProjectAccess, hasCapability, withAccessMetadata } from "../lib/project-access.js";

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
      const access = await getCanvasAccess(canvasId, userId);
      if (!access) return res.status(404).json({ error: "Canvas not found" });

      return res.status(200).json({ canvas: withAccessMetadata(access.canvas, access.projectAccess ?? access) });
    } catch (err) {
      console.error("Get canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // PUT /api/canvases/[id] — Update a canvas
  if (req.method === "PUT") {
    const { title, mermaidCode, chatHistory, isPublic, projectId, manuallyArchived } = req.body || {};

    try {
      const access = await getCanvasAccess(canvasId, userId);
      if (!access) return res.status(404).json({ error: "Canvas not found" });

      const hasContentChange = title !== undefined || mermaidCode !== undefined || chatHistory !== undefined;
      const hasPublishChange = isPublic !== undefined;
      const hasMoveChange = projectId !== undefined;
      const hasArchiveChange = manuallyArchived !== undefined;

      if (hasContentChange && !hasCapability(access, "canvas.update")) {
        return res.status(403).json({ error: "You do not have permission to edit this canvas" });
      }

      if (hasPublishChange && !hasCapability(access, "canvas.publish")) {
        return res.status(403).json({ error: "You do not have permission to publish this canvas" });
      }

      if (hasPublishChange && isPublic === true) {
        await requireFeature(userId, "canvas.publish_public");
      }

      if (hasArchiveChange && !hasCapability(access, "canvas.archive")) {
        return res.status(403).json({ error: "You do not have permission to archive this canvas" });
      }

      if (hasMoveChange && !hasCapability(access, "canvas.move")) {
        return res.status(403).json({ error: "You do not have permission to move this canvas" });
      }

      const nextProjectId = normalizeProjectId(projectId);
      if (projectId !== undefined) {
        if (!nextProjectId) {
          if (!canOwn(access)) return res.status(403).json({ error: "Only the canvas owner can move it to the dashboard root" });
        } else {
          const targetAccess = await getProjectAccess(nextProjectId, userId);
          if (!targetAccess || !hasCapability(targetAccess, "canvas.create") || targetAccess.ownerUserId !== access.ownerUserId) {
            return res.status(400).json({ error: "Project not found" });
          }
        }
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
        .select("*")
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Canvas not found or update failed" });
      }

      if (hasRealChange) {
        const previousProjectId = access.canvas.project_id as string | null | undefined;
        await touchProjectAncestors(previousProjectId, access.ownerUserId, now);
        if (nextProjectId !== previousProjectId) await touchProjectAncestors(nextProjectId, access.ownerUserId, now);
      }

      return res.status(200).json({ canvas: withAccessMetadata(data as Record<string, unknown>, access.projectAccess ?? access) });
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      console.error("Update canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // DELETE /api/canvases/[id] — Delete a canvas
  if (req.method === "DELETE") {
    try {
      const access = await getCanvasAccess(canvasId, userId);
      if (!access) return res.status(404).json({ error: "Canvas not found" });
      if (!hasCapability(access, "canvas.delete")) {
        return res.status(403).json({ error: "You do not have permission to delete this canvas" });
      }
      const result = await deleteCanvasForUser({ canvasId, userId: access.ownerUserId });
      return res.status(200).json({ success: true, ...result });
    } catch (err) {
      console.error("Delete canvas error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
