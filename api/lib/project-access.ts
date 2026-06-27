import { supabase } from "./db.js";
import { PROJECT_SELECT } from "./canvas-projects.js";
import {
  capabilitiesForShareRow,
  legacyAccessForCapabilities,
  legacyCapabilitiesForAccess,
  loadRoleCapabilityMap,
  OWNER_CAPABILITIES,
  roleSummaryForShareRow,
  type CollaborationCapability,
} from "./collaboration-roles.js";

export type ProjectAccessLevel = "owner" | "edit" | "view";

export type ProjectAccess = {
  project: Record<string, unknown>;
  projectId: string;
  ownerUserId: string;
  accessLevel: ProjectAccessLevel;
  capabilities: CollaborationCapability[];
  accessRoleId?: string;
  accessRoleName?: string;
  sharedRootProjectId?: string;
  sharedViaGroupId?: string;
  sharedViaGroupName?: string;
};

export type CanvasAccess = {
  canvas: Record<string, unknown>;
  ownerUserId: string;
  accessLevel: ProjectAccessLevel;
  capabilities: CollaborationCapability[];
  accessRoleId?: string;
  accessRoleName?: string;
  projectAccess?: ProjectAccess;
};

type AccessMetadata = {
  accessLevel: ProjectAccessLevel;
  capabilities?: CollaborationCapability[];
  accessRoleId?: string;
  accessRoleName?: string;
  sharedRootProjectId?: string;
  sharedViaGroupId?: string;
  sharedViaGroupName?: string;
};

export function canEdit(access: { accessLevel: ProjectAccessLevel } | null | undefined) {
  if (!access) return false;
  if (access.accessLevel === "owner" || access.accessLevel === "edit") return true;
  return false;
}

export function canOwn(access: { accessLevel: ProjectAccessLevel } | null | undefined) {
  return access?.accessLevel === "owner";
}

export function hasCapability(
  access: { accessLevel: ProjectAccessLevel; capabilities?: CollaborationCapability[] } | null | undefined,
  capability: CollaborationCapability,
) {
  if (!access) return false;
  if (access.accessLevel === "owner") return true;
  return Boolean(access.capabilities?.includes(capability));
}

function strongestAccess(current: ProjectAccessLevel | null, next: ProjectAccessLevel): ProjectAccessLevel {
  if (current === "owner" || next === "owner") return "owner";
  if (current === "edit" || next === "edit") return "edit";
  return "view";
}

export function withAccessMetadata<T extends Record<string, unknown>>(
  row: T,
  access: AccessMetadata,
) {
  const capabilities = access.accessLevel === "owner"
    ? OWNER_CAPABILITIES
    : access.capabilities ?? legacyCapabilitiesForAccess(access.accessLevel === "edit" ? "edit" : "view");

  return {
    ...row,
    access_level: access.accessLevel,
    access_role_id: access.accessRoleId ?? null,
    access_role_name: access.accessRoleName ?? (access.accessLevel === "owner" ? "Owner" : null),
    capabilities,
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
      capabilities: OWNER_CAPABILITIES,
      accessRoleName: "Owner",
    };
  }

  const groupIds = await loadUserGroupIds(userId);
  if (groupIds.length === 0) return null;

  const ancestorIds = chain.map((item) => String(item.id));
  const { data, error } = await supabase
    .from("project_shares")
    .select("project_id, shared_with_group_id, access_level, role_id, user_groups(name), collaboration_roles(id, name, description, is_system_role)")
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
    role_id?: string | null;
    user_groups?: { name?: string } | null;
    collaboration_roles?: { id?: string; name?: string; description?: string; is_system_role?: boolean } | null;
  }>;
  if (shares.length === 0) return null;

  const byAncestorDistance = new Map(ancestorIds.map((id, index) => [id, index]));
  shares.sort((a, b) => (byAncestorDistance.get(a.project_id) ?? 999) - (byAncestorDistance.get(b.project_id) ?? 999));

  const roleCapabilityMap = await loadRoleCapabilityMap(shares.map((share) => share.role_id || ""));
  const combinedCapabilities = new Set<CollaborationCapability>();
  let accessLevel: ProjectAccessLevel | null = null;
  let selected = shares[0];
  let selectedCapabilities = capabilitiesForShareRow(selected, roleCapabilityMap);
  for (const share of shares) {
    const shareCapabilities = capabilitiesForShareRow(share, roleCapabilityMap);
    for (const capability of shareCapabilities) combinedCapabilities.add(capability);

    const shareAccessLevel = legacyAccessForCapabilities(shareCapabilities);
    accessLevel = strongestAccess(accessLevel, shareAccessLevel);

    const selectedAccessLevel = legacyAccessForCapabilities(selectedCapabilities);
    const shouldSelect =
      (shareAccessLevel === "edit" && selectedAccessLevel !== "edit") ||
      (shareAccessLevel === selectedAccessLevel && shareCapabilities.length > selectedCapabilities.length);
    if (shouldSelect) {
      selected = share;
      selectedCapabilities = shareCapabilities;
    }
  }

  const selectedRole = roleSummaryForShareRow(selected);

  return {
    project,
    projectId,
    ownerUserId,
    accessLevel: accessLevel ?? "view",
    capabilities: [...combinedCapabilities],
    accessRoleId: selectedRole?.id,
    accessRoleName: selectedRole?.name,
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
    return {
      canvas,
      ownerUserId,
      accessLevel: "owner",
      capabilities: OWNER_CAPABILITIES,
      accessRoleName: "Owner",
    };
  }

  const projectId = canvas.project_id ? String(canvas.project_id) : "";
  if (!projectId) return null;

  const projectAccess = await getProjectAccess(projectId, userId);
  if (!projectAccess) return null;

  return {
    canvas,
    ownerUserId,
    accessLevel: projectAccess.accessLevel,
    capabilities: projectAccess.capabilities,
    accessRoleId: projectAccess.accessRoleId,
    accessRoleName: projectAccess.accessRoleName,
    projectAccess,
  };
}
