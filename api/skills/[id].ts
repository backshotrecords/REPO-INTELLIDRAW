import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  // PUT = update skill
  if (req.method === "PUT") {
    const { title, description, instruction_text, category, status } = req.body || {};

    if (status === "archived") {
      const { data, error } = await supabase.from("skill_notes")
        .update({
          is_published: false,
          status: "archived",
          visibility: "private",
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("owner_id", auth.userId)
        .select("*")
        .single();

      if (error || !data) return res.status(404).json({ error: "Skill not found or archive failed" });
      return res.json({ skill: data });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (instruction_text !== undefined) updates.instruction_text = instruction_text;
    if (category !== undefined) updates.category = category;
    if (instruction_text !== undefined) {
      const { data: current } = await supabase.from("skill_notes").select("version").eq("id", id).eq("owner_id", auth.userId).single();
      if (current) updates.version = ((current.version as number) || 1) + 1;
    }
    if (title !== undefined || description !== undefined || instruction_text !== undefined || category !== undefined) {
      const { data: current } = await supabase.from("skill_notes").select("current_published_version_id").eq("id", id).eq("owner_id", auth.userId).single();
      if (current?.current_published_version_id) updates.has_unpublished_changes = true;
    }
    const { data, error } = await supabase.from("skill_notes").update(updates)
      .eq("id", id).eq("owner_id", auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Skill not found or update failed" });
    return res.json({ skill: data });
  }

  // DELETE = delete skill
  if (req.method === "DELETE") {
    const { data: versions } = await supabase.from("skill_note_versions").select("id").eq("skill_note_id", id).limit(1);
    const { data: installs } = await supabase.from("skill_installations").select("id").eq("skill_note_id", id).limit(1);
    if ((versions && versions.length > 0) || (installs && installs.length > 0)) {
      return res.status(409).json({ error: "Published skills with versions or installs cannot be deleted. Archive or unpublish instead." });
    }

    const { error } = await supabase.from("skill_notes").delete()
      .eq("id", id).eq("owner_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to delete skill" });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
