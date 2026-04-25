import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing group id" });

  // PUT = update group name
  if (req.method === "PUT") {
    const { name } = req.body || {};
    const { data, error } = await supabase.from("user_groups").update({ name })
      .eq("id", id).eq("owner_id", auth.userId).select("*").single();
    if (error || !data) return res.status(404).json({ error: "Group not found" });
    return res.json({ group: data });
  }

  // DELETE = delete group
  if (req.method === "DELETE") {
    const { error } = await supabase.from("user_groups").delete()
      .eq("id", id).eq("owner_id", auth.userId);
    if (error) return res.status(500).json({ error: error.message || "Failed to delete group" });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
