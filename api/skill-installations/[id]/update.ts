import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../lib/auth.js";
import { supabase } from "../../lib/db.js";
import { getLatestSkillVersion } from "../../lib/skill-marketplace.js";

async function countStaleAttachments(installationId: string, installedVersionId: string): Promise<number> {
  const { count } = await supabase
    .from("skill_note_attachments")
    .select("id", { count: "exact", head: true })
    .eq("skill_installation_id", installationId)
    .neq("attached_version_id", installedVersionId)
    .eq("is_active", true);

  return count || 0;
}

async function updateAllAttachments(installationId: string, versionId: string, userId: string) {
  const { error } = await supabase
    .from("skill_note_attachments")
    .update({ attached_version_id: versionId })
    .eq("skill_installation_id", installationId)
    .eq("user_id", userId)
    .neq("attached_version_id", versionId);

  if (error) throw error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing installation id" });

  const { update_attachments } = req.body || {};

  const { data: installation } = await supabase
    .from("skill_installations")
    .select("*")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .single();

  if (!installation) return res.status(404).json({ error: "Installation not found" });

  const latest = await getLatestSkillVersion(installation.skill_note_id as string);
  if (!latest) return res.status(404).json({ error: "Source version not found" });

  const { data: updated, error } = await supabase
    .from("skill_installations")
    .update({
      installed_version_id: latest.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("*")
    .single();

  if (error || !updated) return res.status(500).json({ error: error?.message || "Failed to update installation" });

  if (update_attachments) await updateAllAttachments(id, latest.id as string, auth.userId);

  return res.json({
    installation: updated,
    latest_version: latest,
    stale_attachment_count: await countStaleAttachments(id, latest.id as string),
  });
}
