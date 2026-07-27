import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import {
  AgentAccessError,
  createAgentCredential,
  publicAgentConnection,
  requireAgentDatabaseConfiguration,
  type AgentConnectionRecord,
} from "../lib/agent-access.js";
import { supabase } from "../lib/db.js";

const CONNECTION_SELECT =
  "*, canvas_projects(title), agent_connection_folders(*, canvas_projects(title))";

function sendError(res: VercelResponse, error: unknown) {
  if (error instanceof AgentAccessError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("Agent connection error:", error);
  return res.status(500).json({ error: "Internal server error" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const connectionId = typeof req.query.id === "string" ? req.query.id : "";
  if (!connectionId) return res.status(400).json({ error: "Connection ID is required" });

  try {
    requireAgentDatabaseConfiguration();
    const { data: existing, error: lookupError } = await supabase
      .from("agent_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!existing) return res.status(404).json({ error: "Agent connection not found" });

    const connection = existing as AgentConnectionRecord;

    if (req.method === "DELETE") {
      if (connection.revoked_at) {
        return res.status(200).json({ success: true, revokedAt: connection.revoked_at });
      }
      const revokedAt = new Date().toISOString();
      const { error } = await supabase
        .from("agent_connections")
        .update({ revoked_at: revokedAt, updated_at: revokedAt })
        .eq("id", connectionId)
        .eq("user_id", auth.userId);
      if (error) throw error;
      return res.status(200).json({ success: true, revokedAt });
    }

    if (req.method === "PUT") {
      const { name, accessLevel, includeSubfolders, expiresInDays, rotate } = req.body || {};
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let token: string | undefined;

      if (name !== undefined) {
        const cleanName = String(name).trim().slice(0, 80);
        if (!cleanName) return res.status(400).json({ error: "Connection name is required" });
        update.name = cleanName;
      }
      if (accessLevel !== undefined) {
        if (accessLevel !== "read" && accessLevel !== "edit") {
          return res.status(400).json({ error: "Access must be read-only or can edit" });
        }
        update.access_level = accessLevel;
      }
      if (includeSubfolders !== undefined) update.include_subfolders = Boolean(includeSubfolders);
      if (expiresInDays !== undefined) {
        const days = Number(expiresInDays);
        if (![30, 90, 365].includes(days)) {
          return res.status(400).json({ error: "Expiration must be 30, 90, or 365 days" });
        }
        update.expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        update.revoked_at = null;
      }
      if (rotate === true) {
        const credential = createAgentCredential();
        update.token_prefix = credential.tokenPrefix;
        update.token_hash = credential.tokenHash;
        update.revoked_at = null;
        if (new Date(connection.expires_at).getTime() <= Date.now()) {
          update.expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        }
        token = credential.token;
      }

      const { error } = await supabase
        .from("agent_connections")
        .update(update)
        .eq("id", connectionId)
        .eq("user_id", auth.userId);
      if (error) throw error;

      if (connection.root_project_id && (accessLevel !== undefined || includeSubfolders !== undefined)) {
        const legacyFolderUpdate: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (accessLevel !== undefined) legacyFolderUpdate.access_level = accessLevel;
        if (includeSubfolders !== undefined) {
          legacyFolderUpdate.include_subfolders = Boolean(includeSubfolders);
        }
        const { error: legacyFolderError } = await supabase
          .from("agent_connection_folders")
          .update(legacyFolderUpdate)
          .eq("connection_id", connectionId)
          .eq("project_id", connection.root_project_id);
        if (legacyFolderError) throw legacyFolderError;
      }

      const { data, error: loadError } = await supabase
        .from("agent_connections")
        .select(CONNECTION_SELECT)
        .eq("id", connectionId)
        .eq("user_id", auth.userId)
        .single();
      if (loadError || !data) throw loadError || new Error("Connection update returned no row");

      return res.status(200).json({
        connection: publicAgentConnection(data as never),
        ...(token ? { token } : {}),
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
