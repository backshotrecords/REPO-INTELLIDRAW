import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing attachment id" });

  // PUT = toggle active
  if (req.method === "PUT") {
    const { is_active } = req.body;
    const { data, error } = await supabase.from("skill_note_attachments")
      .update({ is_active }).eq("id", id).eq("user_id", auth.userId).select("*, skill_notes(*)").single();
    if (error || !data) return res.status(404).json({ error: "Attachment not found" });
    return res.json({ attachment: { ...data, skill_note: data.skill_notes, skill_notes: undefined } });
  }

  // DELETE = detach
  if (req.method === "DELETE") {
    const { data: att } = await supabase.from("skill_note_attachments").select("skill_note_id")
      .eq("id", id).eq("user_id", auth.userId).single();
    const { error } = await supabase.from("skill_note_attachments").delete()
      .eq("id", id).eq("user_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to detach" });
    // Decrement stars
    if (att) {
      const { data: sn } = await supabase.from("skill_notes").select("stars").eq("id", att.skill_note_id).single();
      if (sn) await supabase.from("skill_notes").update({ stars: Math.max(0, ((sn.stars as number) || 0) - 1) }).eq("id", att.skill_note_id);
    }
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
