import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import {
  extractMermaidExternalContext,
  setMermaidExternalContext,
} from "../../../src/utils/mermaidContext.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;
  const canvasId = req.query.id as string;

  if (!canvasId) {
    return res.status(400).json({ error: "Canvas ID is required" });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("canvases")
      .select("id, mermaid_code")
      .eq("id", canvasId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Canvas not found" });
    }

    return res.status(200).json({
      externalContext: extractMermaidExternalContext(data.mermaid_code || ""),
      mermaidCode: data.mermaid_code,
    });
  }

  if (req.method === "PUT") {
    const { externalContext } = req.body || {};
    if (externalContext === undefined) {
      return res.status(400).json({ error: "externalContext is required" });
    }

    const { data: canvas, error: canvasError } = await supabase
      .from("canvases")
      .select("id, mermaid_code, project_id")
      .eq("id", canvasId)
      .eq("user_id", userId)
      .single();

    if (canvasError || !canvas) {
      return res.status(404).json({ error: "Canvas not found" });
    }

    const currentCode = String(canvas.mermaid_code || "");
    const nextCode = setMermaidExternalContext(currentCode, String(externalContext));
    if (nextCode === currentCode) {
      return res.status(200).json({
        changed: false,
        externalContext: extractMermaidExternalContext(nextCode),
        mermaidCode: nextCode,
      });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("canvases")
      .update({
        mermaid_code: nextCode,
        updated_at: now,
        manually_archived: false,
      })
      .eq("id", canvasId)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (updateError || !updated) {
      return res.status(500).json({ error: "Failed to update external context" });
    }

    const { data: commit, error: commitError } = await supabase
      .from("canvas_commits")
      .insert({
        canvas_id: canvasId,
        mermaid_code: nextCode,
        source: "project_context",
        commit_message: "Updated external project context",
      })
      .select("*")
      .single();

    if (commitError) {
      console.error("Create external context commit error:", commitError);
    }

    return res.status(200).json({
      changed: true,
      canvas: updated,
      commit: commit || null,
      externalContext: extractMermaidExternalContext(nextCode),
      mermaidCode: nextCode,
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
