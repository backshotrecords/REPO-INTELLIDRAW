import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  const { is_published } = req.body || {};
  const { data, error } = await supabase.from("skill_notes")
    .update({ is_published: !!is_published, updated_at: new Date().toISOString() })
    .eq("id", id).eq("owner_id", auth.userId).select("*").single();

  if (error || !data) return res.status(404).json({ error: "Skill not found" });
  return res.json({ skill: data });
}
