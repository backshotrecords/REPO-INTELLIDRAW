import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Direct shares
  const { data: directShares } = await supabase.from("skill_note_shares")
    .select("skill_note_id, skill_notes(*,users!skill_notes_owner_id_fkey(display_name,email))")
    .eq("shared_with_user_id", auth.userId);

  // Group shares
  const { data: myGroups } = await supabase.from("group_members").select("group_id").eq("user_id", auth.userId);
  const groupIds = (myGroups || []).map((g: Record<string, unknown>) => g.group_id as string);
  let groupShares: Record<string, unknown>[] = [];
  if (groupIds.length > 0) {
    const { data } = await supabase.from("skill_note_shares")
      .select("skill_note_id, skill_notes(*,users!skill_notes_owner_id_fkey(display_name,email))")
      .in("shared_with_group_id", groupIds);
    groupShares = (data as Record<string, unknown>[]) || [];
  }

  const seen = new Set<string>();
  const skills: Record<string, unknown>[] = [];
  for (const s of [...((directShares as Record<string, unknown>[]) || []), ...groupShares]) {
    const sn = s.skill_notes as Record<string, unknown> | null;
    const snId = s.skill_note_id as string;
    if (sn && !seen.has(snId)) {
      seen.add(snId);
      const users = sn.users as Record<string, unknown> | null;
      skills.push({ ...sn, owner_display_name: users?.display_name, owner_email: users?.email, users: undefined });
    }
  }

  return res.json({ skills });
}
