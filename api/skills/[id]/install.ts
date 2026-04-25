import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  const { data: source, error: srcErr } = await supabase.from("skill_notes").select("*").eq("id", id).single();
  if (srcErr || !source) return res.status(404).json({ error: "Skill not found" });

  const { data: copy, error } = await supabase.from("skill_notes").insert({
    owner_id: auth.userId, title: source.title, description: source.description,
    instruction_text: source.instruction_text, category: source.category,
    source_skill_id: source.id, source_version: source.version,
  }).select("*").single();

  if (error) return res.status(500).json({ error: error.message || "Failed to install skill" });
  return res.status(201).json({ skill: copy });
}
