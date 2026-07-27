import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import {
  AgentAccessError,
  requireAgentDatabaseConfiguration,
} from "../lib/agent-access.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    requireAgentDatabaseConfiguration();
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
    const connectionId = typeof req.query.connectionId === "string" ? req.query.connectionId : "";
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));

    let query = supabase
      .from("agent_actions")
      .select("*")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (projectId) query = query.eq("root_project_id", projectId);
    if (connectionId) query = query.eq("connection_id", connectionId);

    const { data, error } = await query;
    if (error) throw error;
    return res.status(200).json({ actions: data || [] });
  } catch (error) {
    if (error instanceof AgentAccessError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error("List agent actions error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
