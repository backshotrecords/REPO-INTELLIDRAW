import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { recalculateSkillStars } from "../../lib/skill-stars.js";

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
    const installedVersionId = installation?.installed_version_id as string | undefined;
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
        stars: 0,
        version: version.version_number,
        source_skill_id: null,
        source_version: null,
        created_at: version.published_at,
        updated_at: version.published_at,
      } : a.skill_notes,
      attached_version: version,
      installed_skill: installation ? { ...installation, skill_note: installation.skill_notes, skill_notes: undefined } : undefined,
      has_update: !!installedVersionId && installedVersionId !== a.attached_version_id,
      skill_notes: undefined,
    };
  }

  return { ...a, skill_note: a.skill_notes, skill_notes: undefined };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET = list attachments, POST = create attachment
  if (req.method === "GET") {
    const { canvasId } = req.query;
    let query = supabase.from("skill_note_attachments")
      .select("*, skill_notes(*)").eq("user_id", auth.userId);
    if (canvasId) {
      query = supabase.from("skill_note_attachments")
        .select("*, skill_notes(*)")
        .eq("user_id", auth.userId)
        .or(`canvas_id.eq.${canvasId},scope.eq.global`);
    }
    const { data, error } = await query.order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message || "Failed to fetch attachments" });
    const attachments = await Promise.all((data || []).map((a: Record<string, unknown>) => enrichAttachment(a)));
    return res.json({ attachments });
  }

  if (req.method === "POST") {
    const { skill_note_id, skill_installation_id, canvas_id, scope, trigger_mode } = req.body || {};
    if ((!skill_note_id && !skill_installation_id) || !scope || !trigger_mode) {
      return res.status(400).json({ error: "skill_note_id or skill_installation_id, scope, trigger_mode required" });
    }

    const row: Record<string, unknown> = { skill_note_id, skill_installation_id, user_id: auth.userId, scope, trigger_mode, is_active: true };
    if (canvas_id && scope === "local") row.canvas_id = canvas_id;

    if (skill_installation_id) {
      const { data: installation } = await supabase
        .from("skill_installations")
        .select("*")
        .eq("id", skill_installation_id)
        .eq("user_id", auth.userId)
        .eq("status", "active")
        .single();
      if (!installation) return res.status(404).json({ error: "Installation not found" });
      row.skill_note_id = installation.skill_note_id;
      row.attached_version_id = installation.installed_version_id;
    }

    const { data, error } = await supabase.from("skill_note_attachments").insert(row).select("*, skill_notes(*)").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Already attached" });
      return res.status(500).json({ error: error.message || "Failed to attach" });
    }

    await recalculateSkillStars(row.skill_note_id as string);

    return res.status(201).json({ attachment: await enrichAttachment(data as Record<string, unknown>) });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
