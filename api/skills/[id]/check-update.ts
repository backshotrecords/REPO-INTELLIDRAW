import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  const { data: skill } = await supabase.from("skill_notes").select("source_skill_id, source_version")
    .eq("id", id).eq("owner_id", auth.userId).single();
  if (!skill?.source_skill_id) return res.json({ has_update: false });

  const { data: source } = await supabase.from("skill_notes").select("version").eq("id", skill.source_skill_id).single();
  if (!source) return res.json({ has_update: false });

  return res.json({
    has_update: (source.version as number) > ((skill.source_version as number) || 0),
    source_version: source.version,
    local_version: skill.source_version,
  });
}
