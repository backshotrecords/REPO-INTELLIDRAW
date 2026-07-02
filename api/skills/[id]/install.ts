import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../../lib/entitlements.js";
import { canInstallSkill, enrichSkillForUser, getActiveInstallation } from "../../lib/skill-marketplace.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing skill id" });

  try {
    const { count } = await supabase
      .from("skill_installations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.userId)
      .eq("status", "active");
    await requireFeatureQuota(auth.userId, "skills.install_marketplace", count || 0);
  } catch (err) {
    if (isEntitlementError(err)) return sendEntitlementError(res, err);
    return res.status(500).json({ error: "Failed to check feature access" });
  }

  const { data: source, error: srcErr } = await supabase.from("skill_notes").select("*").eq("id", id).single();
  if (srcErr || !source) return res.status(404).json({ error: "Skill not found" });
  if (!(await canInstallSkill(source as Record<string, unknown>, auth.userId))) {
    return res.status(403).json({ error: "This skill is not available to install" });
  }

  const existing = await getActiveInstallation(id, auth.userId);
  if (existing) {
    return res.json({
      installation: existing,
      skill: await enrichSkillForUser(source as Record<string, unknown>, auth.userId),
      already_installed: true,
    });
  }

  const { data: installation, error } = await supabase.from("skill_installations").insert({
    user_id: auth.userId,
    skill_note_id: source.id,
    installed_version_id: source.current_published_version_id,
    status: "active",
  }).select("*").single();

  if (error) return res.status(500).json({ error: error.message || "Failed to install skill" });
  await recordFeatureUsage(auth.userId, "skills.install_marketplace", 1, {
    skillId: id,
    installationId: installation.id,
  });
  return res.status(201).json({
    installation,
    skill: await enrichSkillForUser(source as Record<string, unknown>, auth.userId),
    already_installed: false,
  });
}
