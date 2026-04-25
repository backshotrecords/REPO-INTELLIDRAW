import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  // POST = share, DELETE = unshare
  if (req.method === "POST") {
    const { email, group_id } = req.body || {};
    if (!email && !group_id) return res.status(400).json({ error: "email or group_id required" });

    const { data: skill } = await supabase.from("skill_notes").select("id").eq("id", id).eq("owner_id", auth.userId).single();
    if (!skill) return res.status(403).json({ error: "You can only share skills you own" });

    const shareRow: Record<string, string> = { skill_note_id: id, shared_by: auth.userId };
    if (email) {
      const { data: targetUser } = await supabase.from("users").select("id").eq("email", (email as string).toLowerCase()).single();
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      shareRow.shared_with_user_id = targetUser.id;
    } else {
      shareRow.shared_with_group_id = group_id as string;
    }

    const { data, error } = await supabase.from("skill_note_shares").insert(shareRow).select("*").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Already shared" });
      return res.status(500).json({ error: error.message || "Failed to share" });
    }
    return res.status(201).json({ share: data });
  }

  if (req.method === "DELETE") {
    const { user_id, group_id } = req.body || {};
    let query = supabase.from("skill_note_shares").delete()
      .eq("skill_note_id", id).eq("shared_by", auth.userId);
    if (user_id) query = query.eq("shared_with_user_id", user_id);
    if (group_id) query = query.eq("shared_with_group_id", group_id);
    const { error } = await query;
    if (error) return res.status(500).json({ error: error.message || "Failed to unshare" });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
