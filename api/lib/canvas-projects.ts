import { supabase } from "./db.js";

export const PROJECT_ACCENTS = new Set(["blue", "cyan", "green", "violet", "amber"]);

export function normalizeProjectId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value);
}

export function normalizeProjectAccent(value: unknown) {
  const accent = String(value || "blue");
  return PROJECT_ACCENTS.has(accent) ? accent : "blue";
}

export async function assertProjectOwned(projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select("id, parent_project_id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data as { id: string; parent_project_id: string | null };
}

export async function getProjectAndDescendantIds(projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select("id, parent_project_id")
    .eq("user_id", userId);

  if (error) throw error;

  const ids = new Set<string>([projectId]);
  let foundNewId = true;

  while (foundNewId) {
    foundNewId = false;
    for (const project of (data || []) as Array<{ id: string; parent_project_id: string | null }>) {
      if (project.parent_project_id && ids.has(project.parent_project_id) && !ids.has(project.id)) {
        ids.add(project.id);
        foundNewId = true;
      }
    }
  }

  return ids;
}

export async function touchProjectAncestors(projectId: string | null | undefined, userId: string, timestamp = new Date().toISOString()) {
  if (!projectId) return;

  const { data, error } = await supabase
    .from("canvas_projects")
    .select("id, parent_project_id")
    .eq("user_id", userId);

  if (error) {
    console.error("Load project ancestors error:", error);
    return;
  }

  const byId = new Map(
    ((data || []) as Array<{ id: string; parent_project_id: string | null }>).map((project) => [project.id, project]),
  );
  const ids: string[] = [];
  let current = byId.get(projectId);

  while (current) {
    ids.push(current.id);
    current = current.parent_project_id ? byId.get(current.parent_project_id) : undefined;
  }

  if (ids.length === 0) return;

  const { error: updateError } = await supabase
    .from("canvas_projects")
    .update({ updated_at: timestamp, manually_archived: false })
    .eq("user_id", userId)
    .in("id", ids);

  if (updateError) {
    console.error("Touch project ancestors error:", updateError);
  }
}
