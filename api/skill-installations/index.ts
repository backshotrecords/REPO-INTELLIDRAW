import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { countActiveUsage, getLatestSkillVersion, getVersionNumber } from "../lib/skill-marketplace.js";

async function staleAttachmentCount(installationId: string, installedVersionId: string): Promise<number> {
  const { count } = await supabase
    .from("skill_note_attachments")
    .select("id", { count: "exact", head: true })
    .eq("skill_installation_id", installationId)
    .neq("attached_version_id", installedVersionId)
    .eq("is_active", true);

  return count || 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authenticateRequest(req);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { data, error } = await supabase
    .from("skill_installations")
    .select("*, skill_notes(*, users!skill_notes_owner_id_fkey(display_name,email)), installed_version:skill_note_versions(*)")
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message || "Failed to fetch installed skills" });

  const installations = await Promise.all(((data || []) as Record<string, unknown>[]).map(async (row) => {
    const skill = row.skill_notes as Record<string, unknown> | null;
    const users = skill?.users as Record<string, unknown> | null;
    if (skill) {
      skill.owner_display_name = users?.display_name;
      skill.owner_email = users?.email;
      skill.active_usage_count = await countActiveUsage(skill.id as string);
      skill.users = undefined;
    }
    const latest = skill ? await getLatestSkillVersion(skill.id as string) : null;
    const installedVersionId = row.installed_version_id as string;
    return {
      ...row,
      skill_note: skill,
      skill_notes: undefined,
      installed_version: row.installed_version,
      latest_version: latest,
      installed_version_number: await getVersionNumber(installedVersionId),
      latest_version_number: latest?.version_number || null,
      has_update: !!latest && latest.id !== installedVersionId,
      stale_attachment_count: await staleAttachmentCount(row.id as string, installedVersionId),
      deprecated: skill?.status === "archived",
    };
  }));

  return res.json({ installations });
}
