import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../../lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing installation id" });

  try {
    await requireFeatureQuota(auth.userId, "skills.remix");
  } catch (err) {
    if (isEntitlementError(err)) return sendEntitlementError(res, err);
    return res.status(500).json({ error: "Failed to check feature access" });
  }

  const { data: installation } = await supabase
    .from("skill_installations")
    .select("*, installed_version:skill_note_versions(*)")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .single();

  if (!installation) return res.status(404).json({ error: "Installation not found" });

  const version = installation.installed_version as Record<string, unknown> | null;
  if (!version) return res.status(404).json({ error: "Installed version not found" });

  const { data: skill, error } = await supabase
    .from("skill_notes")
    .insert({
      owner_id: auth.userId,
      title: `${version.title} Copy`,
      description: version.description || "",
      instruction_text: version.instruction_text,
      category: version.category || "general",
      status: "draft",
      visibility: "private",
    })
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message || "Failed to create private copy" });
  await recordFeatureUsage(auth.userId, "skills.remix", 1, {
    installationId: id,
    skillId: skill.id,
  });
  return res.status(201).json({ skill });
}
