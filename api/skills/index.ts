import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "./lib/auth.js";
import { supabase } from "./lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  // GET = list my skills, POST = create skill
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("skill_notes").select("*")
      .eq("owner_id", auth.userId)
      .order("updated_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message || "Failed to fetch skills" });
    return res.json({ skills: data || [] });
  }

  if (req.method === "POST") {
    const { title, description, instruction_text, category } = req.body || {};
    if (!title || !instruction_text) return res.status(400).json({ error: "Title and instruction_text are required" });
    const { data, error } = await supabase.from("skill_notes")
      .insert({ owner_id: auth.userId, title, description: description || "", instruction_text, category: category || "general" })
      .select("*").single();
    if (error) return res.status(500).json({ error: error.message || "Failed to create skill" });
    return res.status(201).json({ skill: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
