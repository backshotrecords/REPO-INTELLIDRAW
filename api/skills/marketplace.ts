import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { search, category, page } = req.query;
  const pageSize = 30;
  const pageNum = parseInt(page as string) || 1;
  const offset = (pageNum - 1) * pageSize;

  let query = supabase.from("skill_notes")
    .select("*, users!skill_notes_owner_id_fkey(display_name, email)", { count: "exact" })
    .eq("is_published", true)
    .order("stars", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (search) query = query.ilike("title", `%${search}%`);
  if (category && category !== "all") query = query.eq("category", category as string);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message || "Failed to fetch marketplace" });

  const skills = (data || []).map((s: Record<string, unknown>) => {
    const users = s.users as Record<string, unknown> | null;
    return { ...s, owner_display_name: users?.display_name, owner_email: users?.email, users: undefined };
  });

  return res.json({ skills, total: count || 0, page: pageNum, pageSize });
}
