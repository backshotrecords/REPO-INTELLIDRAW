import crypto from "node:crypto";
import OpenAI from "openai";
import { decrypt } from "./crypto.js";
import { supabase } from "./db.js";
import { PROJECT_SELECT } from "./canvas-projects.js";
import { clearMermaidExternalContext } from "../../src/utils/mermaidContext.js";

const PROJECT_CONTEXT_MODEL = process.env.PROJECT_CONTEXT_MODEL || "gpt-4o-mini";
const MAX_CHILD_ITEMS = 30;
const MAX_CONTEXT_CHARS = 1800;
const MAX_SOURCE_TEXT_CHARS = 800;

type ProjectContextStatus = "stale" | "refreshing" | "fresh" | "error";

export type ProjectContextRecord = {
  id: string;
  user_id: string;
  parent_project_id: string | null;
  title: string;
  description: string;
  accent: string;
  manually_archived: boolean;
  local_context: string;
  effective_context: string;
  context_source_hash: string;
  context_parent_hash: string;
  context_status: ProjectContextStatus;
  context_updated_at: string | null;
  context_error: string;
  created_at: string;
  updated_at: string;
};

type ChildCanvasSource = {
  id: string;
  title: string;
  objectives: string;
  content_hash: string;
  updated_at: string;
};

type ChildProjectSource = {
  id: string;
  title: string;
  description: string;
  effective_context: string;
  context_source_hash: string;
  updated_at: string;
};

type ProjectContextSource = {
  project: ProjectContextRecord;
  parent: ProjectContextRecord | null;
  childProjects: ChildProjectSource[];
  childCanvases: ChildCanvasSource[];
  childProjectCount: number;
  childCanvasCount: number;
  sourceHash: string;
  parentHash: string;
};

type GeneratedContext = {
  localContext: string;
  effectiveContext: string;
};

function truncate(value: unknown, maxChars = MAX_CONTEXT_CHARS): string {
  const text = String(value || "").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trim()}...` : text;
}

function hashSource(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function extractObjectives(mermaidCode: string): string {
  const match = mermaidCode.match(/%% OBJECTIVES:\s*(.+)/);
  return truncate(match?.[1] || "", MAX_SOURCE_TEXT_CHARS);
}

function isContextFresh(source: ProjectContextSource): boolean {
  return (
    source.project.context_status === "fresh" &&
    source.project.context_source_hash === source.sourceHash &&
    source.project.context_parent_hash === source.parentHash
  );
}

async function loadProject(projectId: string, userId: string): Promise<ProjectContextRecord | null> {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data as ProjectContextRecord;
}

async function loadProjectContextSource(projectId: string, userId: string): Promise<ProjectContextSource | null> {
  const project = await loadProject(projectId, userId);
  if (!project) return null;

  const parent = project.parent_project_id ? await loadProject(project.parent_project_id, userId) : null;

  const [{ data: childProjectRows }, { data: childCanvasRows }] = await Promise.all([
    supabase
      .from("canvas_projects")
      .select(PROJECT_SELECT)
      .eq("user_id", userId)
      .eq("parent_project_id", projectId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("canvases")
      .select("id, title, mermaid_code, updated_at")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false }),
  ]);

  const childProjects = ((childProjectRows || []) as ProjectContextRecord[])
    .slice(0, MAX_CHILD_ITEMS)
    .map((child) => ({
      id: child.id,
      title: child.title,
      description: truncate(child.description, MAX_SOURCE_TEXT_CHARS),
      effective_context: truncate(child.effective_context, MAX_SOURCE_TEXT_CHARS),
      context_source_hash: child.context_source_hash || "",
      updated_at: child.updated_at,
    }));

  const childCanvases = ((childCanvasRows || []) as Array<{ id: string; title: string; mermaid_code: string; updated_at: string }>)
    .slice(0, MAX_CHILD_ITEMS)
    .map((canvas) => ({
      id: canvas.id,
      title: canvas.title,
      objectives: extractObjectives(canvas.mermaid_code || ""),
      content_hash: hashSource(clearMermaidExternalContext(canvas.mermaid_code || "")),
      updated_at: canvas.updated_at,
    }));

  const parentHash = parent?.context_source_hash || "";
  const hashInput = {
    project: {
      id: project.id,
      title: project.title,
      description: project.description,
      updated_at: project.updated_at,
    },
    parent: parent ? {
      id: parent.id,
      title: parent.title,
      effective_context: parent.effective_context,
      context_source_hash: parent.context_source_hash,
    } : null,
    childProjects,
    childCanvases: childCanvases.map((canvas) => ({
      id: canvas.id,
      title: canvas.title,
      objectives: canvas.objectives,
      content_hash: canvas.content_hash,
    })),
    childProjectCount: (childProjectRows || []).length,
    childCanvasCount: (childCanvasRows || []).length,
  };

  return {
    project,
    parent,
    childProjects,
    childCanvases,
    childProjectCount: (childProjectRows || []).length,
    childCanvasCount: (childCanvasRows || []).length,
    sourceHash: hashSource(hashInput),
    parentHash,
  };
}

async function getUserOpenAiConfig(userId: string) {
  const { data: user } = await supabase
    .from("users")
    .select("api_key_encrypted")
    .eq("id", userId)
    .single();

  if (!user?.api_key_encrypted) return null;
  return {
    apiKey: decrypt(user.api_key_encrypted),
    modelId: PROJECT_CONTEXT_MODEL,
  };
}

function buildContextPrompt(source: ProjectContextSource): string {
  return `Generate compact folder context for IntelliDraw.

Return JSON only with exactly these keys:
{
  "localContext": "summary of this folder's direct purpose and direct child folders/canvases",
  "effectiveContext": "compressed parent inherited context plus this folder's local context for children to inherit"
}

Rules:
- Keep each value under 160 words.
- Use plain text, no markdown headings.
- Mention sibling/direct-child relationships when they clarify the folder purpose.
- Prefer stable project intent over tiny implementation details.
- If parent context is empty, base effectiveContext on localContext.

Folder:
${JSON.stringify({
  title: source.project.title,
  description: source.project.description,
  directChildFolderCount: source.childProjectCount,
  directChildCanvasCount: source.childCanvasCount,
}, null, 2)}

Parent effective context:
${source.parent?.effective_context || "(none)"}

Direct child folders:
${JSON.stringify(source.childProjects, null, 2)}

Direct child canvases:
${JSON.stringify(source.childCanvases, null, 2)}`;
}

function parseGeneratedContext(response: string, source: ProjectContextSource): GeneratedContext {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<GeneratedContext>;
      const localContext = truncate(parsed.localContext, MAX_CONTEXT_CHARS);
      const effectiveContext = truncate(parsed.effectiveContext, MAX_CONTEXT_CHARS);
      if (localContext && effectiveContext) return { localContext, effectiveContext };
    } catch {
      // Fall through to deterministic fallback.
    }
  }

  const localParts = [
    source.project.description ? `${source.project.title}: ${source.project.description}` : source.project.title,
    source.childProjects.length > 0
      ? `Direct folders: ${source.childProjects.map((child) => child.title).join(", ")}.`
      : "",
    source.childCanvases.length > 0
      ? `Direct canvases: ${source.childCanvases.map((canvas) => canvas.title).join(", ")}.`
      : "",
  ].filter(Boolean);
  const localContext = truncate(localParts.join(" "));
  const effectiveContext = truncate([source.parent?.effective_context, localContext].filter(Boolean).join(" "));
  return { localContext, effectiveContext: effectiveContext || localContext };
}

async function generateProjectContext(source: ProjectContextSource, userId: string): Promise<GeneratedContext> {
  const config = await getUserOpenAiConfig(userId);
  if (!config) throw new Error("No OpenAI API key configured");

  const openai = new OpenAI({ apiKey: config.apiKey });
  const completion = await openai.chat.completions.create({
    model: config.modelId,
    messages: [
      {
        role: "system",
        content: "You produce compact project context caches for flowchart workspaces.",
      },
      {
        role: "user",
        content: buildContextPrompt(source),
      },
    ],
    temperature: 0.2,
    max_tokens: 700,
  });

  return parseGeneratedContext(completion.choices[0]?.message?.content || "", source);
}

export async function ensureProjectContextFresh(
  projectId: string,
  userId: string,
  opts: { force?: boolean; refreshAncestors?: boolean; depth?: number } = {},
) {
  const depth = opts.depth ?? 0;
  let source = await loadProjectContextSource(projectId, userId);
  if (!source) return null;

  if (opts.refreshAncestors !== false && source.project.parent_project_id && depth < 12) {
    await ensureProjectContextFresh(source.project.parent_project_id, userId, {
      force: opts.force,
      refreshAncestors: true,
      depth: depth + 1,
    });
    source = await loadProjectContextSource(projectId, userId);
    if (!source) return null;
  }

  if (!opts.force && isContextFresh(source)) {
    return { project: source.project, refreshed: false, sourceHash: source.sourceHash };
  }

  await supabase
    .from("canvas_projects")
    .update({ context_status: "refreshing", context_error: "" })
    .eq("id", projectId)
    .eq("user_id", userId);

  try {
    const generated = await generateProjectContext(source, userId);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("canvas_projects")
      .update({
        local_context: generated.localContext,
        effective_context: generated.effectiveContext,
        context_source_hash: source.sourceHash,
        context_parent_hash: source.parentHash,
        context_status: "fresh",
        context_updated_at: now,
        context_error: "",
      })
      .eq("id", projectId)
      .eq("user_id", userId)
      .select(PROJECT_SELECT)
      .single();

    if (error || !data) throw new Error("Failed to save project context");

    return { project: data as ProjectContextRecord, refreshed: true, sourceHash: source.sourceHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to refresh project context";
    const { data } = await supabase
      .from("canvas_projects")
      .update({ context_status: "error", context_error: message })
      .eq("id", projectId)
      .eq("user_id", userId)
      .select(PROJECT_SELECT)
      .single();

    throw Object.assign(new Error(message), { project: data as ProjectContextRecord | null });
  }
}
