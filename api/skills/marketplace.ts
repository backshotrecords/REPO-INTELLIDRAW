import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { applyPublishedVersionFields, enrichSkillForUser } from "../lib/skill-marketplace.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { search, category, page } = req.query;
  const pageSize = 30;
  const pageNum = parseInt(page as string) || 1;

  const query = supabase.from("skill_notes")
    .select("*, users!skill_notes_owner_id_fkey(display_name, email)")
    .eq("status", "published")
    .eq("visibility", "public")
    .order("stars", { ascending: false });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message || "Failed to fetch marketplace" });

  const skills = await Promise.all((data || []).map(async (s: Record<string, unknown>) => {
    const users = s.users as Record<string, unknown> | null;
    const publishedSkill = await applyPublishedVersionFields({
      ...s,
      owner_display_name: users?.display_name,
      owner_email: users?.email,
      users: undefined,
    });
    return enrichSkillForUser(publishedSkill, auth.userId);
  }));

  const searchText = typeof search === "string" ? search.toLowerCase() : "";
  const filtered = skills.filter((skill) => {
    const matchesSearch = !searchText ||
      String(skill.title || "").toLowerCase().includes(searchText) ||
      String(skill.description || "").toLowerCase().includes(searchText);
    const matchesCategory = !category || category === "all" || skill.category === category;
    return matchesSearch && matchesCategory;
  });

  filtered.sort((a, b) => ((b.active_usage_count as number) || 0) - ((a.active_usage_count as number) || 0));

  const offset = (pageNum - 1) * pageSize;
  const pageSkills = filtered.slice(offset, offset + pageSize);

  return res.json({ skills: pageSkills, total: filtered.length, page: pageNum, pageSize });
}
