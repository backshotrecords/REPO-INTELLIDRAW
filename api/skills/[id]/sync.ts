import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  const { data: skill } = await supabase.from("skill_notes").select("source_skill_id")
    .eq("id", id).eq("owner_id", auth.userId).single();
  if (!skill?.source_skill_id) return res.status(400).json({ error: "No source skill to sync from" });

  const { data: source } = await supabase.from("skill_notes")
    .select("title, description, instruction_text, category, version")
    .eq("id", skill.source_skill_id).single();
  if (!source) return res.status(404).json({ error: "Source skill no longer exists" });

  const { data: updated, error } = await supabase.from("skill_notes").update({
    title: source.title, description: source.description, instruction_text: source.instruction_text,
    category: source.category, source_version: source.version, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("owner_id", auth.userId).select("*").single();

  if (error) return res.status(500).json({ error: error.message || "Failed to sync" });
  return res.json({ skill: updated });
}
