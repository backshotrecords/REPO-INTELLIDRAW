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

const MAX_ACTIVE_FOLDERS = 25;
const FOLDER_SELECT = "*, canvas_projects(title)";

function sendError(res: VercelResponse, error: unknown) {
  if (error instanceof AgentAccessError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("Agent connection folders error:", error);
  return res.status(500).json({ error: "Internal server error" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const connectionId = typeof req.query.id === "string" ? req.query.id : "";
  if (!connectionId) return res.status(400).json({ error: "Connection ID is required" });

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

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("agent_connection_folders")
        .select(FOLDER_SELECT)
        .eq("connection_id", connectionId)
        .order("created_at");
      if (error) throw error;
      return res.status(200).json({
        folders: (data || []).map((row) => publicAgentFolderGrant(row as never)),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (connection.revoked_at || new Date(connection.expires_at).getTime() <= Date.now()) {
      return res.status(409).json({ error: "Reactivate or replace this connection before adding folders" });
    }

    const {
      projectId,
      accessLevel = "read",
      includeSubfolders = true,
    } = req.body || {};
    if (!projectId || typeof projectId !== "string") {
      return res.status(400).json({ error: "Folder is required" });
    }
    if (accessLevel !== "read" && accessLevel !== "edit") {
      return res.status(400).json({ error: "Access must be read-only or can edit" });
    }

    const projectAccess = await getProjectAccess(projectId, auth.userId);
    if (!projectAccess || !hasCapability(projectAccess, "project.manage_shares")) {
      return res.status(403).json({ error: "You do not have permission to manage agent access for this folder" });
    }

    const { data: activeRows, error: activeError } = await supabase
      .from("agent_connection_folders")
      .select("*")
      .eq("connection_id", connectionId)
      .is("revoked_at", null);
    if (activeError) throw activeError;
    const activeFolders = (activeRows || []) as AgentFolderGrantRecord[];
    const existingExact = activeFolders.find((folder) => folder.project_id === projectId);
    if (existingExact) {
      return res.status(409).json({ error: "This folder is already connected" });
    }
    if (activeFolders.length >= MAX_ACTIVE_FOLDERS) {
      return res.status(409).json({ error: `A connection can authorize up to ${MAX_ACTIVE_FOLDERS} folders` });
    }

    for (const folder of activeFolders) {
      if (folder.include_subfolders && await isProjectWithin(projectId, folder.project_id)) {
        return res.status(409).json({
          error: "This folder is already covered by a connected parent folder that includes subfolders",
        });
      }
      if (includeSubfolders && await isProjectWithin(folder.project_id, projectId)) {
        return res.status(409).json({
          error: "This folder would overlap an existing connected child folder. Remove the child grant first or exclude subfolders.",
        });
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("agent_connection_folders")
      .upsert({
        connection_id: connectionId,
        project_id: projectId,
        access_level: accessLevel,
        include_subfolders: Boolean(includeSubfolders),
        revoked_at: null,
        updated_at: now,
      }, { onConflict: "connection_id,project_id" })
      .select(FOLDER_SELECT)
      .single();
    if (error || !data) throw error || new Error("Folder authorization returned no row");

    if (!connection.root_project_id) {
      const { error: legacyUpdateError } = await supabase
        .from("agent_connections")
        .update({
          root_project_id: projectId,
          access_level: accessLevel,
          include_subfolders: Boolean(includeSubfolders),
          updated_at: now,
        })
        .eq("id", connectionId)
        .eq("user_id", auth.userId);
      if (legacyUpdateError) throw legacyUpdateError;
    }

    return res.status(201).json({
      folder: publicAgentFolderGrant(data as never),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
