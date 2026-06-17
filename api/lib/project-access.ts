import { supabase } from "./db.js";
import { PROJECT_SELECT } from "./canvas-projects.js";

export type ProjectAccessLevel = "owner" | "edit" | "view";

export type ProjectAccess = {
  project: Record<string, unknown>;
  projectId: string;
  ownerUserId: string;
  accessLevel: ProjectAccessLevel;
  sharedRootProjectId?: string;
  sharedViaGroupId?: string;
  sharedViaGroupName?: string;
};

export type CanvasAccess = {
  canvas: Record<string, unknown>;
  ownerUserId: string;
  accessLevel: ProjectAccessLevel;
  projectAccess?: ProjectAccess;
};

export function canEdit(access: { accessLevel: ProjectAccessLevel } | null | undefined) {
  return access?.accessLevel === "owner" || access?.accessLevel === "edit";
}

export function canOwn(access: { accessLevel: ProjectAccessLevel } | null | undefined) {
  return access?.accessLevel === "owner";
}

function strongestAccess(current: ProjectAccessLevel | null, next: ProjectAccessLevel): ProjectAccessLevel {
  if (current === "owner" || next === "owner") return "owner";
  if (current === "edit" || next === "edit") return "edit";
  return "view";
}

export function withAccessMetadata<T extends Record<string, unknown>>(
  row: T,
  access: Pick<ProjectAccess, "accessLevel" | "sharedRootProjectId" | "sharedViaGroupId" | "sharedViaGroupName">,
) {
  return {
    ...row,
    access_level: access.accessLevel,
    shared_root_project_id: access.sharedRootProjectId ?? null,
    shared_via_group_id: access.sharedViaGroupId ?? null,
    shared_via_group_name: access.sharedViaGroupName ?? null,
  };
}

async function loadUserGroupIds(userId: string) {
  const { data, error } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  if (error) {
    console.error("Load user groups error:", error);
    return [];
  }

  return ((data || []) as Array<{ group_id: string }>).map((membership) => membership.group_id);
}

async function loadProject(projectId: string) {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .single();

  if (error || !data) return null;
  return data as Record<string, unknown>;
}

async function loadProjectChain(projectId: string) {
  const chain: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let current = await loadProject(projectId);

  while (current) {
    const id = String(current.id);
    if (seen.has(id)) break;
    seen.add(id);
    chain.push(current);

    const parentId = current.parent_project_id ? String(current.parent_project_id) : "";
    current = parentId ? await loadProject(parentId) : null;
  }

  return chain;
}

export async function getProjectAccess(projectId: string, userId: string): Promise<ProjectAccess | null> {
  const chain = await loadProjectChain(projectId);
  const project = chain[0];
  if (!project) return null;

  const ownerUserId = String(project.user_id);
  if (ownerUserId === userId) {
    return {
      project,
      projectId,
      ownerUserId,
      accessLevel: "owner",
    };
  }

  const groupIds = await loadUserGroupIds(userId);
  if (groupIds.length === 0) return null;

  const ancestorIds = chain.map((item) => String(item.id));
  const { data, error } = await supabase
    .from("project_shares")
    .select("project_id, shared_with_group_id, access_level, user_groups(name)")
    .in("project_id", ancestorIds)
    .in("shared_with_group_id", groupIds);

  if (error) {
    console.error("Load project shares error:", error);
    return null;
  }

  const shares = (data || []) as Array<{
    project_id: string;
    shared_with_group_id: string;
    access_level: "view" | "edit";
    user_groups?: { name?: string } | null;
  }>;
  if (shares.length === 0) return null;

  const byAncestorDistance = new Map(ancestorIds.map((id, index) => [id, index]));
  shares.sort((a, b) => (byAncestorDistance.get(a.project_id) ?? 999) - (byAncestorDistance.get(b.project_id) ?? 999));

  let accessLevel: ProjectAccessLevel | null = null;
  let selected = shares[0];
  for (const share of shares) {
    accessLevel = strongestAccess(accessLevel, share.access_level);
    if (share.access_level === "edit") selected = share;
  }

  return {
    project,
    projectId,
    ownerUserId,
    accessLevel: accessLevel ?? "view",
    sharedRootProjectId: selected.project_id,
    sharedViaGroupId: selected.shared_with_group_id,
    sharedViaGroupName: selected.user_groups?.name || "",
  };
}

export async function getCanvasAccess(canvasId: string, userId: string): Promise<CanvasAccess | null> {
  const { data, error } = await supabase
    .from("canvases")
    .select("*")
    .eq("id", canvasId)
    .single();

  if (error || !data) return null;

  const canvas = data as Record<string, unknown>;
  const ownerUserId = String(canvas.user_id);
  if (ownerUserId === userId) {
    return { canvas, ownerUserId, accessLevel: "owner" };
  }

  const projectId = canvas.project_id ? String(canvas.project_id) : "";
  if (!projectId) return null;

  const projectAccess = await getProjectAccess(projectId, userId);
  if (!projectAccess) return null;

  return {
    canvas,
    ownerUserId,
    accessLevel: projectAccess.accessLevel,
    projectAccess,
  };
}

