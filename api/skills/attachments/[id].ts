import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

const VALID_SCOPES = new Set(["local", "global"]);
const VALID_TRIGGER_MODES = new Set(["automatic", "manual", "contextual"]);

async function enrichAttachment(a: Record<string, unknown>) {
  if (a.attached_version_id) {
    const { data: version } = await supabase
      .from("skill_note_versions")
      .select("*")
      .eq("id", a.attached_version_id)
      .single();
    const { data: installation } = a.skill_installation_id
      ? await supabase
        .from("skill_installations")
        .select("*, skill_notes(*)")
        .eq("id", a.skill_installation_id)
        .single()
      : { data: null };

    return {
      ...a,
      skill_note: version ? {
        id: version.skill_note_id,
        owner_id: installation?.skill_notes?.owner_id || "",
        title: version.title,
        description: version.description,
        instruction_text: version.instruction_text,
        category: version.category,
        is_published: true,
        version: version.version_number,
        source_skill_id: null,
        source_version: null,
        created_at: version.published_at,
        updated_at: version.published_at,
      } : a.skill_notes,
      attached_version: version,
      installed_skill: installation ? { ...installation, skill_note: installation.skill_notes, skill_notes: undefined } : undefined,
      skill_notes: undefined,
    };
  }

  return { ...a, skill_note: a.skill_notes, skill_notes: undefined };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing attachment id" });

  // PUT = update active state, scope, and/or trigger mode
  if (req.method === "PUT") {
    const { is_active, scope, trigger_mode, canvas_id } = req.body || {};
    const updates: Record<string, unknown> = {};

    if (is_active !== undefined) updates.is_active = Boolean(is_active);
    if (scope !== undefined) {
      if (!VALID_SCOPES.has(scope)) return res.status(400).json({ error: "Invalid scope" });
      updates.scope = scope;
      updates.canvas_id = scope === "local" ? canvas_id || null : null;
    }
    if (trigger_mode !== undefined) {
      if (!VALID_TRIGGER_MODES.has(trigger_mode)) return res.status(400).json({ error: "Invalid trigger_mode" });
      updates.trigger_mode = trigger_mode;
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updates provided" });

    const { data, error } = await supabase.from("skill_note_attachments")
      .update(updates).eq("id", id).eq("user_id", auth.userId).select("*, skill_notes(*)").single();
    if (error) {
      if (error.code === "23514" && trigger_mode === "contextual") {
        return res.status(409).json({
          error: "Contextual skills require the production database migration for trigger_mode = contextual.",
        });
      }
      return res.status(404).json({ error: "Attachment not found" });
    }
    if (!data) return res.status(404).json({ error: "Attachment not found" });
    return res.json({ attachment: await enrichAttachment(data as Record<string, unknown>) });
  }

  // DELETE = detach
  if (req.method === "DELETE") {
    const { error } = await supabase.from("skill_note_attachments").delete()
      .eq("id", id).eq("user_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to detach" });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
