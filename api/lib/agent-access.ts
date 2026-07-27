import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { supabase } from "./db.js";
import { getCanvasAccess, getProjectAccess, hasCapability } from "./project-access.js";

export type AgentAccessLevel = "read" | "edit";

export type AgentConnectionRecord = {
  id: string;
  user_id: string;
  root_project_id: string | null;
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

export type AgentFolderGrantRecord = {
  id: string;
  connection_id: string;
  project_id: string;
  access_level: AgentAccessLevel;
  include_subfolders: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentPrincipal = {
  connection: AgentConnectionRecord;
  userId: string;
  folders: AgentFolderGrantRecord[];
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

export function publicAgentFolderGrant(row: AgentFolderGrantRecord & {
  canvas_projects?: { title?: string } | null;
}) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.canvas_projects?.title || "",
    accessLevel: row.access_level,
    includeSubfolders: row.include_subfolders,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function publicAgentConnection(row: AgentConnectionRecord & {
  canvas_projects?: { title?: string } | null;
  agent_connection_folders?: Array<AgentFolderGrantRecord & {
    canvas_projects?: { title?: string } | null;
  }>;
}) {
  const folders = (row.agent_connection_folders || [])
    .map(publicAgentFolderGrant)
    .sort((left, right) => left.projectTitle.localeCompare(right.projectTitle));
  const activeFolders = folders.filter((folder) => !folder.revokedAt);
  const firstFolder = activeFolders[0] || folders[0];

  return {
    id: row.id,
    rootProjectId: firstFolder?.projectId || row.root_project_id || null,
    rootProjectTitle: firstFolder?.projectTitle || row.canvas_projects?.title || "",
    name: row.name,
    tokenPrefix: row.token_prefix,
    accessLevel: firstFolder?.accessLevel || row.access_level,
    includeSubfolders: firstFolder?.includeSubfolders ?? row.include_subfolders,
    folders,
    activeFolderCount: activeFolders.length,
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

  const { data: folderRows, error: folderError } = await supabase
    .from("agent_connection_folders")
    .select("*")
    .eq("connection_id", connection.id)
    .is("revoked_at", null)
    .order("created_at");

  if (folderError) {
    console.error("Agent folder grants lookup error:", folderError);
    throw new AgentAccessError(503, "agent_access_unavailable", "Agent folder access is temporarily unavailable.");
  }

  await supabase
    .from("agent_connections")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", connection.id);

  return {
    connection,
    userId: connection.user_id,
    folders: (folderRows || []) as AgentFolderGrantRecord[],
  };
}

async function loadProjectParent(projectId: string) {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select("id, user_id, parent_project_id, title, updated_at")
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
    updated_at: string;
  } | null;
}

async function loadProjectAncestry(projectId: string) {
  const ancestry: Array<NonNullable<Awaited<ReturnType<typeof loadProjectParent>>>> = [];
  const visited = new Set<string>();
  let currentId = projectId;

  for (let depth = 0; depth < 64 && currentId; depth += 1) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const current = await loadProjectParent(currentId);
    if (!current) break;
    ancestry.push(current);
    currentId = current.parent_project_id || "";
  }

  return ancestry;
}

export async function isProjectWithin(projectId: string, possibleAncestorId: string) {
  const ancestry = await loadProjectAncestry(projectId);
  return ancestry.some((project) => project.id === possibleAncestorId);
}

export async function listAvailableAgentFolders(principal: AgentPrincipal) {
  const available: Array<{
    folderGrant: AgentFolderGrantRecord;
    project: NonNullable<Awaited<ReturnType<typeof loadProjectParent>>>;
    ownerUserId: string;
  }> = [];

  for (const folderGrant of principal.folders) {
    const [project, access] = await Promise.all([
      loadProjectParent(folderGrant.project_id),
      getProjectAccess(folderGrant.project_id, principal.userId),
    ]);
    if (!project || !access || !hasCapability(access, "project.manage_shares")) continue;
    available.push({
      folderGrant,
      project,
      ownerUserId: access.ownerUserId,
    });
  }

  return available;
}

export async function requireProjectInAgentScope(
  principal: AgentPrincipal,
  projectId: string,
  capability: "project.view" | "canvas.create" = "project.view",
) {
  const [access, ancestry] = await Promise.all([
    getProjectAccess(projectId, principal.userId),
    loadProjectAncestry(projectId),
  ]);
  if (!access || !hasCapability(access, capability)) {
    throw new AgentAccessError(404, "folder_not_found", "Folder not found in this agent connection.");
  }

  const ancestryIndex = new Map(ancestry.map((project, index) => [project.id, index]));
  const candidates = principal.folders
    .map((folderGrant) => ({
      folderGrant,
      depth: ancestryIndex.get(folderGrant.project_id),
    }))
    .filter((candidate) => (
      candidate.depth !== undefined
      && (candidate.depth === 0 || candidate.folderGrant.include_subfolders)
    ))
    .sort((left, right) => Number(left.depth) - Number(right.depth));

  for (const candidate of candidates) {
    const rootAccess = await getProjectAccess(candidate.folderGrant.project_id, principal.userId);
    if (
      rootAccess
      && rootAccess.ownerUserId === access.ownerUserId
      && hasCapability(rootAccess, "project.manage_shares")
    ) {
      return {
        ...access,
        folderGrant: candidate.folderGrant,
      };
    }
  }

  throw new AgentAccessError(404, "folder_not_found", "Folder not found in this agent connection.");
}

export async function requireCanvasInAgentScope(
  principal: AgentPrincipal,
  canvasId: string,
  capability: "canvas.view" | "canvas.update" | "canvas.commit" = "canvas.view",
) {
  const access = await getCanvasAccess(canvasId, principal.userId);
  if (!access || !hasCapability(access, capability)) {
    throw new AgentAccessError(404, "flowchart_not_found", "Flowchart not found in this agent connection.");
  }

  const projectId = access.canvas.project_id ? String(access.canvas.project_id) : "";
  if (!projectId) {
    throw new AgentAccessError(404, "flowchart_not_found", "Flowchart not found in this agent connection.");
  }

  const projectAccess = await requireProjectInAgentScope(principal, projectId);
  return {
    ...access,
    folderGrant: projectAccess.folderGrant,
  };
}

export function requireAgentWriteAccess(folderGrant: AgentFolderGrantRecord) {
  if (folderGrant.access_level !== "edit") {
    throw new AgentAccessError(403, "read_only_connection", "This folder is read-only for this agent connection.");
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
