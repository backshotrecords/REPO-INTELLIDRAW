import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import { supabase } from "../../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing attachment id" });

  const { data: attachment } = await supabase
    .from("skill_note_attachments")
    .select("*, installation:skill_installations(*)")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .single();

  if (!attachment) return res.status(404).json({ error: "Attachment not found" });

  const installation = attachment.installation as Record<string, unknown> | null;
  if (!installation?.installed_version_id) return res.status(400).json({ error: "Attachment is not linked to an installed skill" });

  const update = { attached_version_id: installation.installed_version_id };
  let query = supabase
    .from("skill_note_attachments")
    .update(update)
    .eq("user_id", auth.userId)
    .eq("skill_installation_id", attachment.skill_installation_id);

  if (attachment.scope === "local") {
    query = query.eq("id", id);
  } else {
    query = query.eq("scope", "global");
  }

  const { data, error } = await query.select("*");
  if (error) return res.status(500).json({ error: error.message || "Failed to update attachment" });

  return res.json({ attachments: data || [] });
}
