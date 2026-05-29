import { touchProjectAncestors } from "./canvas-projects.js";
import { supabase } from "./db.js";

type CanvasDeletionRecord = {
  id: string;
  project_id: string | null;
};

export type CanvasDeletionResult = {
  deletedCanvasIds: string[];
  affectedProjectIds: string[];
  deletedCount: number;
};

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function loadCanvasDeletionRecords(userId: string, canvasIds: string[]): Promise<CanvasDeletionRecord[]> {
  const { data, error } = await supabase
    .from("canvases")
    .select("id, project_id")
    .eq("user_id", userId)
    .in("id", canvasIds);

  if (error) throw error;
  return (data || []) as CanvasDeletionRecord[];
}

export async function deleteCanvasesForUser({
  canvasIds,
  userId,
}: {
  canvasIds: string[];
  userId: string;
}): Promise<CanvasDeletionResult> {
  const requestedIds = uniqueValues(canvasIds);
  if (requestedIds.length === 0) {
    return { deletedCanvasIds: [], affectedProjectIds: [], deletedCount: 0 };
  }

  const canvases = await loadCanvasDeletionRecords(userId, requestedIds);
  const deletedCanvasIds = canvases.map((canvas) => canvas.id);
  const affectedProjectIds = uniqueValues(canvases.map((canvas) => canvas.project_id));

  if (deletedCanvasIds.length === 0) {
    return { deletedCanvasIds: [], affectedProjectIds: [], deletedCount: 0 };
  }

  const { error } = await supabase
    .from("canvases")
    .delete()
    .eq("user_id", userId)
    .in("id", deletedCanvasIds);

  if (error) throw error;

  await Promise.all(affectedProjectIds.map((projectId) => touchProjectAncestors(projectId, userId)));

  return {
    deletedCanvasIds,
    affectedProjectIds,
    deletedCount: deletedCanvasIds.length,
  };
}

export async function deleteCanvasForUser({
  canvasId,
  userId,
}: {
  canvasId: string;
  userId: string;
}): Promise<CanvasDeletionResult> {
  return deleteCanvasesForUser({ canvasIds: [canvasId], userId });
}

export async function deleteCanvasesInProjectsForUser({
  projectIds,
  userId,
}: {
  projectIds: string[];
  userId: string;
}): Promise<CanvasDeletionResult> {
  const targetProjectIds = uniqueValues(projectIds);
  if (targetProjectIds.length === 0) {
    return { deletedCanvasIds: [], affectedProjectIds: [], deletedCount: 0 };
  }

  const { data, error } = await supabase
    .from("canvases")
    .select("id")
    .eq("user_id", userId)
    .in("project_id", targetProjectIds);

  if (error) throw error;

  const canvasIds = ((data || []) as Array<{ id: string }>).map((canvas) => canvas.id);
  return deleteCanvasesForUser({ canvasIds, userId });
}
