import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { supabase } from "./db.js";
import { getCanvasAccess, getProjectAccess, hasCapability } from "./project-access.js";

export type AgentAccessLevel = "read" | "edit";

export type AgentConnectionRecord = {
  id: string;
  user_id: string;
  root_project_id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  access_level: AgentAccessLevel;
  include_subfolders: boolean;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentPrincipal = {
  connection: AgentConnectionRecord;
  userId: string;
  rootProjectId: string;
  ownerUserId: string;
};

export class AgentAccessError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AgentAccessError";
    this.status = status;
    this.code = code;
  }
}

export function requireAgentDatabaseConfiguration() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AgentAccessError(
      503,
      "agent_access_not_configured",
      "Agent access requires the Supabase service role key in the production environment.",
    );
  }
}

export function createAgentCredential() {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `ida_${keyId}_${secret}`;
  return {
    token,
    tokenPrefix: `ida_${keyId}`,
    tokenHash: hashAgentToken(token),
  };
}

export function hashAgentToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashMermaidCode(mermaidCode: string) {
  return createHash("sha256").update(mermaidCode, "utf8").digest("hex");
}

export function tokenPrefixFromToken(token: string) {
  const match = /^ida_([a-f0-9]{16})_([A-Za-z0-9_-]{40,})$/.exec(token);
  return match ? `ida_${match[1]}` : null;
}

function secureHashMatch(actualHash: string, expectedHash: string) {
  const actual = Buffer.from(actualHash, "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function publicAgentConnection(row: AgentConnectionRecord & {
  canvas_projects?: { title?: string } | null;
}) {
  return {
    id: row.id,
    rootProjectId: row.root_project_id,
    rootProjectTitle: row.canvas_projects?.title || "",
    name: row.name,
    tokenPrefix: row.token_prefix,
    accessLevel: row.access_level,
    includeSubfolders: row.include_subfolders,
    expiresAt: row.expires_at,
    isExpired: new Date(row.expires_at).getTime() <= Date.now(),
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bearerToken(req: VercelRequest) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

export async function authenticateAgentRequest(req: VercelRequest): Promise<AgentPrincipal> {
  requireAgentDatabaseConfiguration();

  const token = bearerToken(req);
  const tokenPrefix = token ? tokenPrefixFromToken(token) : null;
  if (!token || !tokenPrefix) {
    throw new AgentAccessError(401, "invalid_token", "A valid Intellidraw agent token is required.");
  }

  const { data, error } = await supabase
    .from("agent_connections")
    .select("*")
    .eq("token_prefix", tokenPrefix)
    .maybeSingle();

  if (error) {
    console.error("Agent token lookup error:", error);
    throw new AgentAccessError(503, "agent_access_unavailable", "Agent access is temporarily unavailable.");
  }

  const connection = data as AgentConnectionRecord | null;
  const suppliedHash = hashAgentToken(token);
  if (!connection || !secureHashMatch(suppliedHash, connection.token_hash)) {
    throw new AgentAccessError(401, "invalid_token", "The Intellidraw agent token is invalid.");
  }

  if (connection.revoked_at) {
    throw new AgentAccessError(401, "revoked_token", "This Intellidraw agent connection has been revoked.");
  }

  if (new Date(connection.expires_at).getTime() <= Date.now()) {
    throw new AgentAccessError(401, "expired_token", "This Intellidraw agent connection has expired.");
  }

  const rootAccess = await getProjectAccess(connection.root_project_id, connection.user_id);
  if (!rootAccess || !hasCapability(rootAccess, "project.manage_shares")) {
    throw new AgentAccessError(
      403,
      "connection_permission_removed",
      "The user who created this connection can no longer manage access to its folder.",
    );
  }

  await supabase
    .from("agent_connections")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", connection.id);

  return {
    connection,
    userId: connection.user_id,
    rootProjectId: connection.root_project_id,
    ownerUserId: rootAccess.ownerUserId,
  };
}

async function loadProjectParent(projectId: string) {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select("id, user_id, parent_project_id, title")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    console.error("Agent project scope lookup error:", error);
    throw new AgentAccessError(503, "agent_access_unavailable", "Could not verify the folder scope.");
  }
  return data as {
    id: string;
    user_id: string;
    parent_project_id: string | null;
    title: string;
  } | null;
}

export async function requireProjectInAgentScope(
  principal: AgentPrincipal,
  projectId: string,
  capability: "project.view" | "canvas.create" = "project.view",
) {
  const access = await getProjectAccess(projectId, principal.userId);
  if (!access || access.ownerUserId !== principal.ownerUserId || !hasCapability(access, capability)) {
    throw new AgentAccessError(404, "folder_not_found", "Folder not found in this agent connection.");
  }

  if (projectId === principal.rootProjectId) return access;
  if (!principal.connection.include_subfolders) {
    throw new AgentAccessError(404, "folder_not_found", "Folder not found in this agent connection.");
  }

  const visited = new Set<string>();
  let currentId = projectId;
  for (let depth = 0; depth < 64 && currentId; depth += 1) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    if (currentId === principal.rootProjectId) return access;
    const current = await loadProjectParent(currentId);
    currentId = current?.parent_project_id || "";
  }

  throw new AgentAccessError(404, "folder_not_found", "Folder not found in this agent connection.");
}

export async function requireCanvasInAgentScope(
  principal: AgentPrincipal,
  canvasId: string,
  capability: "canvas.view" | "canvas.update" | "canvas.commit" = "canvas.view",
) {
  const access = await getCanvasAccess(canvasId, principal.userId);
  if (!access || access.ownerUserId !== principal.ownerUserId || !hasCapability(access, capability)) {
    throw new AgentAccessError(404, "flowchart_not_found", "Flowchart not found in this agent connection.");
  }

  const projectId = access.canvas.project_id ? String(access.canvas.project_id) : "";
  if (!projectId) {
    throw new AgentAccessError(404, "flowchart_not_found", "Flowchart not found in this agent connection.");
  }

  await requireProjectInAgentScope(principal, projectId);
  return access;
}

export function requireAgentWriteAccess(principal: AgentPrincipal) {
  if (principal.connection.access_level !== "edit") {
    throw new AgentAccessError(403, "read_only_connection", "This agent connection is read-only.");
  }
}

export type MermaidValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export function validateAgentMermaid(mermaidCode: string): MermaidValidation {
  const code = String(mermaidCode || "").trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!code) errors.push("Mermaid code is required.");
  if (code.length > 100_000) errors.push("Mermaid code must be 100,000 characters or fewer.");
  if (code && !/^(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)\b/i.test(code)) {
    errors.push("The diagram must start with a Mermaid flowchart or graph direction.");
  }

  if (/<script\b|javascript\s*:/i.test(code)) {
    errors.push("Executable script content is not allowed.");
  }
  if (/^\s*click\s+\S+\s+(?:href|call)\b/im.test(code)) {
    errors.push("Interactive links and callbacks are not allowed in agent-authored flowcharts.");
  }
  if (/^\s*%%\{init:/im.test(code)) {
    warnings.push("Diagram-level Mermaid initialization is ignored by Intellidraw.");
  }

  return { valid: errors.length === 0, errors, warnings };
}
