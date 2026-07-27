import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import {
  AgentAccessError,
  isProjectWithin,
  publicAgentFolderGrant,
  requireAgentDatabaseConfiguration,
  type AgentConnectionRecord,
  type AgentFolderGrantRecord,
} from "../../../lib/agent-access.js";
import { supabase } from "../../../lib/db.js";
import { getProjectAccess, hasCapability } from "../../../lib/project-access.js";

const FOLDER_SELECT = "*, canvas_projects(title)";

function sendError(res: VercelResponse, error: unknown) {
  if (error instanceof AgentAccessError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("Agent connection folder error:", error);
  return res.status(500).json({ error: "Internal server error" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const connectionId = typeof req.query.id === "string" ? req.query.id : "";
  const folderId = typeof req.query.folderId === "string" ? req.query.folderId : "";
  if (!connectionId || !folderId) {
    return res.status(400).json({ error: "Connection and folder grant IDs are required" });
  }

  try {
    requireAgentDatabaseConfiguration();
    const { data: connectionRow, error: connectionError } = await supabase
      .from("agent_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connectionRow) return res.status(404).json({ error: "Agent connection not found" });
    const connection = connectionRow as AgentConnectionRecord;

    const { data: folderRow, error: folderError } = await supabase
      .from("agent_connection_folders")
      .select("*")
      .eq("id", folderId)
      .eq("connection_id", connectionId)
      .maybeSingle();
    if (folderError) throw folderError;
    if (!folderRow) return res.status(404).json({ error: "Folder authorization not found" });
    const folder = folderRow as AgentFolderGrantRecord;

    if (req.method === "DELETE") {
      if (folder.revoked_at) {
        return res.status(200).json({ success: true, revokedAt: folder.revoked_at });
      }
      const revokedAt = new Date().toISOString();
      const { error } = await supabase
        .from("agent_connection_folders")
        .update({ revoked_at: revokedAt, updated_at: revokedAt })
        .eq("id", folderId)
        .eq("connection_id", connectionId);
      if (error) throw error;

      if (connection.root_project_id === folder.project_id) {
        const { data: replacement, error: replacementError } = await supabase
          .from("agent_connection_folders")
          .select("*")
          .eq("connection_id", connectionId)
          .is("revoked_at", null)
          .neq("id", folderId)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        if (replacementError) throw replacementError;
        const replacementFolder = replacement as AgentFolderGrantRecord | null;
        const { error: legacyUpdateError } = await supabase
          .from("agent_connections")
          .update({
            root_project_id: replacementFolder?.project_id || null,
            ...(replacementFolder ? {
              access_level: replacementFolder.access_level,
              include_subfolders: replacementFolder.include_subfolders,
            } : {}),
            updated_at: revokedAt,
          })
          .eq("id", connectionId)
          .eq("user_id", auth.userId);
        if (legacyUpdateError) throw legacyUpdateError;
      }

      return res.status(200).json({ success: true, revokedAt });
    }

    if (req.method !== "PUT") {
      res.setHeader("Allow", "PUT, DELETE");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (folder.revoked_at) {
      return res.status(409).json({ error: "Add this folder again before changing its access" });
    }

    const { accessLevel, includeSubfolders } = req.body || {};
    if (accessLevel !== undefined && accessLevel !== "read" && accessLevel !== "edit") {
      return res.status(400).json({ error: "Access must be read-only or can edit" });
    }
    if (accessLevel === undefined && includeSubfolders === undefined) {
      return res.status(400).json({ error: "No folder access changes were provided" });
    }

    const projectAccess = await getProjectAccess(folder.project_id, auth.userId);
    if (!projectAccess || !hasCapability(projectAccess, "project.manage_shares")) {
      return res.status(403).json({ error: "You do not have permission to manage agent access for this folder" });
    }

    if (includeSubfolders === true && !folder.include_subfolders) {
      const { data: otherRows, error: otherError } = await supabase
        .from("agent_connection_folders")
        .select("*")
        .eq("connection_id", connectionId)
        .is("revoked_at", null)
        .neq("id", folderId);
      if (otherError) throw otherError;
      for (const other of (otherRows || []) as AgentFolderGrantRecord[]) {
        if (await isProjectWithin(other.project_id, folder.project_id)) {
          return res.status(409).json({
            error: "Including subfolders would overlap another connected folder. Remove the child grant first.",
          });
        }
      }
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { updated_at: now };
    if (accessLevel !== undefined) update.access_level = accessLevel;
    if (includeSubfolders !== undefined) update.include_subfolders = Boolean(includeSubfolders);
    const { data, error } = await supabase
      .from("agent_connection_folders")
      .update(update)
      .eq("id", folderId)
      .eq("connection_id", connectionId)
      .select(FOLDER_SELECT)
      .single();
    if (error || !data) throw error || new Error("Folder authorization update returned no row");

    if (connection.root_project_id === folder.project_id) {
      const legacyUpdate: Record<string, unknown> = { updated_at: now };
      if (accessLevel !== undefined) legacyUpdate.access_level = accessLevel;
      if (includeSubfolders !== undefined) {
        legacyUpdate.include_subfolders = Boolean(includeSubfolders);
      }
      const { error: legacyError } = await supabase
        .from("agent_connections")
        .update(legacyUpdate)
        .eq("id", connectionId)
        .eq("user_id", auth.userId);
      if (legacyError) throw legacyError;
    }

    return res.status(200).json({
      folder: publicAgentFolderGrant(data as never),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
