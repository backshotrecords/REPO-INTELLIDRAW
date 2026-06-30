import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../lib/entitlements.js";
import { enrichSkillForUser } from "../lib/skill-marketplace.js";

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
    const skills = await Promise.all(((data || []) as Record<string, unknown>[]).map((skill) => enrichSkillForUser(skill, auth.userId)));
    return res.json({ skills });
  }

  if (req.method === "POST") {
    const { title, description, instruction_text, category } = req.body || {};
    if (!title || !instruction_text) return res.status(400).json({ error: "Title and instruction_text are required" });
    try {
      const { count } = await supabase
        .from("skill_notes")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", auth.userId);
      await requireFeatureQuota(auth.userId, "skills.create", count || 0);
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
    const { data, error } = await supabase.from("skill_notes")
      .insert({
        owner_id: auth.userId,
        title,
        description: description || "",
        instruction_text,
        category: category || "general",
        status: "draft",
        visibility: "private",
      })
      .select("*").single();
    if (error) return res.status(500).json({ error: error.message || "Failed to create skill" });
    await recordFeatureUsage(auth.userId, "skills.create", 1, {
      skillId: data.id,
    });
    return res.status(201).json({ skill: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
