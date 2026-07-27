import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import {
  AgentAccessError,
  createAgentCredential,
  publicAgentConnection,
  requireAgentDatabaseConfiguration,
} from "../lib/agent-access.js";
import { supabase } from "../lib/db.js";
import { getProjectAccess, hasCapability } from "../lib/project-access.js";

function sendError(res: VercelResponse, error: unknown) {
  if (error instanceof AgentAccessError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error("Agent connections error:", error);
  return res.status(500).json({ error: "Internal server error" });
}
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  try {
    requireAgentDatabaseConfiguration();

    if (req.method === "GET") {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
      let query = supabase
        .from("agent_connections")
        .select("*, canvas_projects(title)")
        .eq("user_id", auth.userId)
        .order("created_at", { ascending: false });
      if (projectId) query = query.eq("root_project_id", projectId);

      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({
        connections: (data || []).map((row) => publicAgentConnection(row as never)),
      });
    }

    if (req.method === "POST") {
      const {
        projectId,
        name,
        accessLevel = "read",
        includeSubfolders = true,
        expiresInDays = 90,
      } = req.body || {};

      if (!projectId || typeof projectId !== "string") {
        return res.status(400).json({ error: "Folder is required" });
      }
      const cleanName = String(name || "Code agent").trim().slice(0, 80);
      if (!cleanName) return res.status(400).json({ error: "Connection name is required" });
      if (accessLevel !== "read" && accessLevel !== "edit") {
        return res.status(400).json({ error: "Access must be read-only or can edit" });
      }

      const days = Number(expiresInDays);
      if (![30, 90, 365].includes(days)) {
        return res.status(400).json({ error: "Expiration must be 30, 90, or 365 days" });
      }

      const projectAccess = await getProjectAccess(projectId, auth.userId);
      if (!projectAccess || !hasCapability(projectAccess, "project.manage_shares")) {
        return res.status(403).json({ error: "You do not have permission to manage agent access for this folder" });
      }

      const credential = createAgentCredential();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("agent_connections")
        .insert({
          user_id: auth.userId,
          root_project_id: projectId,
          name: cleanName,
          token_prefix: credential.tokenPrefix,
          token_hash: credential.tokenHash,
          access_level: accessLevel,
          include_subfolders: Boolean(includeSubfolders),
          expires_at: expiresAt,
          updated_at: now.toISOString(),
        })
        .select("*, canvas_projects(title)")
        .single();

      if (error || !data) {
        console.error("Create agent connection error:", error);
        return res.status(500).json({ error: "Failed to create agent connection" });
      }

      return res.status(201).json({
        connection: publicAgentConnection(data as never),
        token: credential.token,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
