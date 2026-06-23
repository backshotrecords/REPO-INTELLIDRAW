import { supabase } from "./db.js";

export const CAPABILITY_DEFINITIONS = [
  {
    key: "project.view",
    label: "View projects",
    description: "Open shared project folders and see their contents.",
    category: "Projects",
  },
  {
    key: "project.create_folder",
    label: "Create folders",
    description: "Create sub-project folders inside shared projects.",
    category: "Projects",
  },
  {
    key: "project.update",
    label: "Edit project details",
    description: "Rename projects and update project descriptions or accents.",
    category: "Projects",
  },
  {
    key: "project.move",
    label: "Move folders",
    description: "Move project folders within the same project owner workspace.",
    category: "Projects",
  },
  {
    key: "project.archive",
    label: "Archive folders",
    description: "Move project folders into long-term memory.",
    category: "Projects",
  },
  {
    key: "project.delete",
    label: "Delete folders",
    description: "Delete project folders and their contained canvases.",
    category: "Projects",
  },
  {
    key: "project.manage_shares",
    label: "Manage sharing",
    description: "Add, change, or remove project group access.",
    category: "Projects",
  },
  {
    key: "canvas.view",
    label: "View canvases",
    description: "Open and inspect canvases in shared projects.",
    category: "Canvases",
  },
  {
    key: "canvas.create",
    label: "Create canvases",
    description: "Create canvases inside shared projects.",
    category: "Canvases",
  },
  {
    key: "canvas.update",
    label: "Edit canvases",
    description: "Update canvas title, Mermaid code, chat history, and project context.",
    category: "Canvases",
  },
  {
    key: "canvas.commit",
    label: "Commit versions",
    description: "Create saved canvas commits.",
    category: "Canvases",
  },
  {
    key: "canvas.move",
    label: "Move canvases",
    description: "Move canvases between folders in the same project owner workspace.",
    category: "Canvases",
  },
  {
    key: "canvas.archive",
    label: "Archive canvases",
    description: "Move canvases into long-term memory.",
    category: "Canvases",
  },
  {
    key: "canvas.delete",
    label: "Delete canvases",
    description: "Delete canvases from shared projects.",
    category: "Canvases",
  },
  {
    key: "canvas.publish",
    label: "Publish canvases",
    description: "Toggle public canvas sharing.",
    category: "Canvases",
  },
] as const;

export type CollaborationCapability = typeof CAPABILITY_DEFINITIONS[number]["key"];
export type LegacyShareAccessLevel = "view" | "edit";

export type CollaborationRole = {
  id: string;
  name: string;
  description: string;
  is_system_role: boolean;
  capabilities: CollaborationCapability[];
  created_at?: string;
  updated_at?: string;
};

export type CollaborationRoleSummary = Pick<
  CollaborationRole,
  "id" | "name" | "description" | "is_system_role"
>;

type RoleCapabilityRow = {
  role_id: string;
  capability: string;
};

type RoleRow = {
  id: string;
  name: string;
  description?: string | null;
  is_system_role?: boolean | null;
  created_at?: string;
  updated_at?: string;
  collaboration_role_capabilities?: Array<{ capability?: string | null }> | null;
};

export type SharePermissionRow = {
  access_level?: LegacyShareAccessLevel | null;
  role_id?: string | null;
  collaboration_roles?: { id?: string; name?: string; description?: string; is_system_role?: boolean } | null;
};

const CAPABILITY_SET = new Set<string>(CAPABILITY_DEFINITIONS.map((definition) => definition.key));

export const VIEWER_CAPABILITIES: CollaborationCapability[] = [
  "project.view",
  "canvas.view",
];

export const EDITOR_CAPABILITIES: CollaborationCapability[] = [
  "project.view",
  "project.create_folder",
  "project.update",
  "canvas.view",
  "canvas.create",
  "canvas.update",
  "canvas.commit",
];

export const MANAGER_CAPABILITIES: CollaborationCapability[] = [
  ...EDITOR_CAPABILITIES,
  "project.move",
  "project.archive",
  "project.delete",
  "project.manage_shares",
  "canvas.move",
  "canvas.archive",
  "canvas.delete",
  "canvas.publish",
];

export const OWNER_CAPABILITIES: CollaborationCapability[] = CAPABILITY_DEFINITIONS.map((definition) => definition.key);

export function normalizeCapabilities(value: unknown): CollaborationCapability[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<CollaborationCapability>();
  for (const item of value) {
    if (typeof item !== "string" || !CAPABILITY_SET.has(item)) continue;
    seen.add(item as CollaborationCapability);
  }
  return [...seen];
}

export function legacyCapabilitiesForAccess(accessLevel?: LegacyShareAccessLevel | null) {
  return accessLevel === "edit" ? EDITOR_CAPABILITIES : VIEWER_CAPABILITIES;
}

export function legacyAccessForCapabilities(capabilities: readonly CollaborationCapability[]): LegacyShareAccessLevel {
  const canChange =
    capabilities.some((capability) => capability !== "project.view" && capability !== "canvas.view");
  return canChange ? "edit" : "view";
}

export function capabilitiesForShareRow(
  share: SharePermissionRow,
  roleCapabilityMap: Map<string, CollaborationCapability[]>,
) {
  if (share.role_id && roleCapabilityMap.has(share.role_id)) {
    const capabilities = roleCapabilityMap.get(share.role_id);
    return capabilities ?? [];
  }
  return legacyCapabilitiesForAccess(share.access_level);
}

export function roleSummaryForShareRow(share: SharePermissionRow): CollaborationRoleSummary | null {
  if (!share.role_id || !share.collaboration_roles) return null;
  return {
    id: share.role_id,
    name: share.collaboration_roles.name || "Custom role",
    description: share.collaboration_roles.description || "",
    is_system_role: Boolean(share.collaboration_roles.is_system_role),
  };
}

export async function loadRoleCapabilityMap(roleIds: string[]) {
  const uniqueIds = [...new Set(roleIds.filter(Boolean))];
  const map = new Map<string, CollaborationCapability[]>();
  for (const roleId of uniqueIds) map.set(roleId, []);
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from("collaboration_role_capabilities")
    .select("role_id, capability")
    .in("role_id", uniqueIds);

  if (error) {
    console.error("Load collaboration role capabilities error:", error);
    return map;
  }

  for (const row of (data || []) as RoleCapabilityRow[]) {
    if (!CAPABILITY_SET.has(row.capability)) continue;
    const roleCapabilities = map.get(row.role_id) ?? [];
    roleCapabilities.push(row.capability as CollaborationCapability);
    map.set(row.role_id, roleCapabilities);
  }

  return map;
}

export async function listCollaborationRoles(): Promise<CollaborationRole[]> {
  const { data, error } = await supabase
    .from("collaboration_roles")
    .select("id, name, description, is_system_role, created_at, updated_at, collaboration_role_capabilities(capability)")
    .order("is_system_role", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data || []) as RoleRow[]).map(hydrateRole);
}

export async function listCollaborationRoleSummaries(): Promise<CollaborationRoleSummary[]> {
  const { data, error } = await supabase
    .from("collaboration_roles")
    .select("id, name, description, is_system_role")
    .order("is_system_role", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw error;
  return ((data || []) as RoleRow[]).map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description || "",
    is_system_role: Boolean(role.is_system_role),
  }));
}

export async function getCollaborationRole(roleId: string): Promise<CollaborationRole | null> {
  const { data, error } = await supabase
    .from("collaboration_roles")
    .select("id, name, description, is_system_role, created_at, updated_at, collaboration_role_capabilities(capability)")
    .eq("id", roleId)
    .single();

  if (error || !data) return null;
  return hydrateRole(data as RoleRow);
}

export async function getDefaultRoleForAccess(accessLevel: LegacyShareAccessLevel) {
  const name = accessLevel === "edit" ? "Editor" : "Viewer";
  const { data, error } = await supabase
    .from("collaboration_roles")
    .select("id, name, description, is_system_role")
    .eq("name", name)
    .single();

  if (error || !data) return null;
  return data as CollaborationRoleSummary;
}

function hydrateRole(row: RoleRow): CollaborationRole {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    is_system_role: Boolean(row.is_system_role),
    capabilities: normalizeCapabilities((row.collaboration_role_capabilities || []).map((item) => item.capability)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
