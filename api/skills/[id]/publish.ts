import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { isEntitlementError, requireFeature, sendEntitlementError } from "../../lib/entitlements.js";
import { publishSkill } from "../../lib/skill-marketplace.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  const { is_published, visibility, release_notes } = req.body || {};

  if (is_published !== false && visibility !== "private") {
    try {
      await requireFeature(auth.userId, "skills.publish_public");
    } catch (err) {
      if (isEntitlementError(err)) return sendEntitlementError(res, err);
      return res.status(500).json({ error: "Failed to check feature access" });
    }
  }

  if (is_published === false || visibility === "private") {
    const { data, error } = await supabase.from("skill_notes")
      .update({
        is_published: false,
        status: "unpublished",
        visibility: "private",
        unpublished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id).eq("owner_id", auth.userId).select("*").single();

    if (error || !data) return res.status(404).json({ error: "Skill not found" });
    return res.json({ skill: data });
  }

  const nextVisibility = visibility === "shared" ? "shared" : "public";
  const skill = await publishSkill(id, auth.userId, nextVisibility, release_notes || "");

  if (!skill) return res.status(404).json({ error: "Skill not found" });
  return res.json({ skill });
}
