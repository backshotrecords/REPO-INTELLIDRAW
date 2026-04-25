import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

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
    const attachments = (data || []).map((a: Record<string, unknown>) => ({ ...a, skill_note: a.skill_notes, skill_notes: undefined }));
    return res.json({ attachments });
  }

  if (req.method === "POST") {
    const { skill_note_id, canvas_id, scope, trigger_mode } = req.body || {};
    if (!skill_note_id || !scope || !trigger_mode) return res.status(400).json({ error: "skill_note_id, scope, trigger_mode required" });

    const row: Record<string, unknown> = { skill_note_id, user_id: auth.userId, scope, trigger_mode, is_active: true };
    if (canvas_id && scope === "local") row.canvas_id = canvas_id;

    const { data, error } = await supabase.from("skill_note_attachments").insert(row).select("*, skill_notes(*)").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Already attached" });
      return res.status(500).json({ error: error.message || "Failed to attach" });
    }

    // Increment stars
    const { data: sn } = await supabase.from("skill_notes").select("stars").eq("id", skill_note_id).single();
    if (sn) await supabase.from("skill_notes").update({ stars: ((sn.stars as number) || 0) + 1 }).eq("id", skill_note_id);

    return res.status(201).json({ attachment: { ...data, skill_note: (data as Record<string, unknown>).skill_notes, skill_notes: undefined } });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
