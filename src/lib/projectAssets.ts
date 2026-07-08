// Project Assets — shared types, constants, and tree helpers.
//
// Assets are registered once per ROOT project folder: every folder and canvas
// under the same top-level folder shares one registry; different root folders
// have fully separate registries. An asset is either a markdown document
// (editable in place) or a reference to a canvas/folder inside the same root
// tree. Assets can be linked to specific mermaid nodes on canvases.
//
// Persistence lives in Supabase via the /api/assets endpoints (see
// api/assets/ and db/migrations/migration_project_assets.sql). Server rows
// are snake_case; src/lib/api.ts maps them into these UI shapes.

export type ProjectAssetAccent = "blue" | "green" | "cyan" | "violet" | "amber" | "rose";
export type ProjectAssetLinkStatus = "active" | "pending";
export type ProjectAssetType = "markdown" | "canvas" | "project";

export interface ProjectAsset {
  id: string;
  scope: string; // ROOT project id, or "unfiled" for canvases without a project
  type: ProjectAssetType;
  name: string;
  /** Markdown assets: the document body. */
  markdown?: string;
  /** Reference assets: the canvas/project id they point at. */
  targetId?: string;
  accent: ProjectAssetAccent;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssetLink {
  id: string;
  scope: string;
  assetId: string;
  canvasId: string;
  nodeId: string;
  status: ProjectAssetLinkStatus;
  created_at: string;
}

export interface RegisterProjectAssetInput {
  type: ProjectAssetType;
  name: string;
  targetId?: string;
  markdown?: string;
  accent?: ProjectAssetAccent;
}

export const UNFILED_ASSET_SCOPE = "unfiled";

export const ASSET_ACCENT_CYCLE: ProjectAssetAccent[] = ["blue", "cyan", "green", "violet", "amber", "rose"];

export const ASSET_ACCENT_STROKE: Record<ProjectAssetAccent, string> = {
  blue: "#075aa8",
  green: "#116b34",
  cyan: "#057085",
  violet: "#5f26bd",
  amber: "#9a5a00",
  rose: "#b0325a",
};

export const ASSET_ACCENT_TILE: Record<ProjectAssetAccent, string> = {
  blue: "bg-[#d1e0ff]/80 text-[#075aa8]",
  green: "bg-[#d5f6e1]/90 text-[#116b34]",
  cyan: "bg-[#d7f4fc]/90 text-[#057085]",
  violet: "bg-[#ebe7ff]/90 text-[#5f26bd]",
  amber: "bg-[#fff0d1]/90 text-[#9a5a00]",
  rose: "bg-[#ffe0ec]/90 text-[#b0325a]",
};

export const ASSET_TYPE_META: Record<ProjectAssetType, { label: string; icon: string }> = {
  markdown: { label: "Markdown doc", icon: "description" },
  canvas: { label: "Canvas link", icon: "account_tree" },
  project: { label: "Folder link", icon: "folder" },
};

export function getProjectAssetIcon(asset: Pick<ProjectAsset, "type">): string {
  return ASSET_TYPE_META[asset.type]?.icon ?? "description";
}

// ── Root/tree helpers (shared by workspace + dashboard integrations) ──

interface ProjectLike {
  id: string;
  parent_project_id: string | null;
}

/** Walks parent_project_id up to the top-level ancestor. */
export function resolveRootProjectId(projectId: string, projects: ProjectLike[]): string {
  const byId = new Map(projects.map((project) => [project.id, project]));
  let current = byId.get(projectId);
  if (!current) return projectId;
  const visited = new Set<string>();
  while (current.parent_project_id && byId.has(current.parent_project_id) && !visited.has(current.id)) {
    visited.add(current.id);
    current = byId.get(current.parent_project_id)!;
  }
  return current.id;
}

/** Root id plus every descendant folder id. */
export function collectProjectTreeIds(rootId: string, projects: ProjectLike[]): Set<string> {
  const treeIds = new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const project of projects) {
      if (project.parent_project_id === parentId && !treeIds.has(project.id)) {
        treeIds.add(project.id);
        queue.push(project.id);
      }
    }
  }
  return treeIds;
}

// ── Cross-surface change notifications ──
// The workspace canvas and dashboard tree view can be mounted in the same
// session; after one mutates the registry it pings the other to refetch.

const CHANGE_EVENT = "intellidraw:project-assets-changed";

export function notifyProjectAssetsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeToProjectAssets(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
