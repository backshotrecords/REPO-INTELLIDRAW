import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { ensureProjectContextFresh } from "../../lib/project-context.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const projectId = req.query.id as string;
  if (!projectId) {
    return res.status(400).json({ error: "Project ID is required" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const force = Boolean(req.body?.force);

  try {
    const result = await ensureProjectContextFresh(projectId, authPayload.userId, {
      force,
      refreshAncestors: true,
    });

    if (!result) return res.status(404).json({ error: "Project not found" });

    return res.status(200).json({
      project: result.project,
      refreshed: result.refreshed,
      sourceHash: result.sourceHash,
    });
  } catch (err) {
    const project = typeof err === "object" && err && "project" in err
      ? (err as { project?: unknown }).project
      : null;
    const message = err instanceof Error ? err.message : "Failed to refresh project context";

    return res.status(500).json({
      error: message,
      project,
    });
  }
}
