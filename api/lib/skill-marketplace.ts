import { supabase } from "./db.js";

export type SkillRecord = Record<string, unknown>;
export type SkillVersionRecord = Record<string, unknown>;
export type SkillInstallationRecord = Record<string, unknown>;

export async function getLatestSkillVersion(skillId: string): Promise<SkillVersionRecord | null> {
  const { data } = await supabase
    .from("skill_note_versions")
    .select("*")
    .eq("skill_note_id", skillId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as SkillVersionRecord | null) || null;
}

export async function createSkillVersion(
  skill: SkillRecord,
  createdBy: string,
  releaseNotes = "",
): Promise<SkillVersionRecord | null> {
  const latest = await getLatestSkillVersion(skill.id as string);
  const nextVersion = latest ? ((latest.version_number as number) || 0) + 1 : 1;

  const { data, error } = await supabase
    .from("skill_note_versions")
    .insert({
      skill_note_id: skill.id,
      version_number: nextVersion,
      title: skill.title,
      description: skill.description || "",
      instruction_text: skill.instruction_text,
      category: skill.category || "general",
      release_notes: releaseNotes,
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) throw error;
  return (data as SkillVersionRecord | null) || null;
}

export async function publishSkill(
  skillId: string,
  ownerId: string,
  visibility: "public" | "shared",
  releaseNotes = "",
): Promise<SkillRecord | null> {
  const { data: skill, error: skillError } = await supabase
    .from("skill_notes")
    .select("*")
    .eq("id", skillId)
    .eq("owner_id", ownerId)
    .single();

  if (skillError || !skill) return null;

  const version = await createSkillVersion(skill as SkillRecord, ownerId, releaseNotes);
  if (!version) return null;

  const { data: updated, error } = await supabase
    .from("skill_notes")
    .update({
      is_published: visibility === "public",
      status: "published",
      visibility,
      current_published_version_id: version.id,
      has_unpublished_changes: false,
      unpublished_at: null,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", skillId)
    .eq("owner_id", ownerId)
    .select("*")
    .single();

  if (error) throw error;
  return (updated as SkillRecord | null) || null;
}

export async function ensureReleasedSkill(
  skillId: string,
  ownerId: string,
  visibility: "public" | "shared",
): Promise<SkillRecord | null> {
  const { data: skill, error } = await supabase
    .from("skill_notes")
    .select("*")
    .eq("id", skillId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !skill) return null;

  if ((skill as SkillRecord).current_published_version_id) {
    if ((skill as SkillRecord).visibility !== visibility && (skill as SkillRecord).visibility !== "public") {
      const { data: updated, error: updateError } = await supabase
        .from("skill_notes")
        .update({
          status: "published",
          visibility,
          is_published: visibility === "public",
          updated_at: new Date().toISOString(),
        })
        .eq("id", skillId)
        .eq("owner_id", ownerId)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return (updated as SkillRecord | null) || null;
    }
    return skill as SkillRecord;
  }

  return publishSkill(skillId, ownerId, visibility);
}

export async function getUserGroupIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  return ((data || []) as SkillRecord[])
    .map((row) => row.group_id as string)
    .filter(Boolean);
}

export async function hasSharedAccess(skillId: string, userId: string): Promise<boolean> {
  const { data: direct } = await supabase
    .from("skill_note_shares")
    .select("id")
    .eq("skill_note_id", skillId)
    .eq("shared_with_user_id", userId)
    .limit(1)
    .maybeSingle();

  if (direct) return true;

  const groupIds = await getUserGroupIds(userId);
  if (groupIds.length === 0) return false;

  const { data: groupShare } = await supabase
    .from("skill_note_shares")
    .select("id")
    .eq("skill_note_id", skillId)
    .in("shared_with_group_id", groupIds)
    .limit(1)
    .maybeSingle();

  return !!groupShare;
}

export async function canInstallSkill(skill: SkillRecord, userId: string): Promise<boolean> {
  if (skill.owner_id === userId) return false;
  if (skill.status === "archived") return false;
  if (!skill.current_published_version_id) return false;
  if (skill.status !== "published") return false;
  if (skill.visibility === "public") return true;
  if (skill.visibility === "shared") return hasSharedAccess(skill.id as string, userId);
  return false;
}

export async function getActiveInstallation(
  skillId: string,
  userId: string,
): Promise<SkillInstallationRecord | null> {
  const { data } = await supabase
    .from("skill_installations")
    .select("*")
    .eq("skill_note_id", skillId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  return (data as SkillInstallationRecord | null) || null;
}

export async function getVersionNumber(versionId?: string | null): Promise<number | null> {
  if (!versionId) return null;
  const { data } = await supabase
    .from("skill_note_versions")
    .select("version_number")
    .eq("id", versionId)
    .maybeSingle();

  return data ? ((data as SkillVersionRecord).version_number as number) : null;
}

export async function countActiveInstallations(skillId: string): Promise<number> {
  const { count } = await supabase
    .from("skill_installations")
    .select("id", { count: "exact", head: true })
    .eq("skill_note_id", skillId)
    .eq("status", "active");

  return count || 0;
}

export async function countActiveUsage(skillId: string): Promise<number> {
  const { data: installations } = await supabase
    .from("skill_installations")
    .select("id")
    .eq("skill_note_id", skillId)
    .eq("status", "active");

  const installationIds = ((installations || []) as SkillRecord[])
    .map((row) => row.id as string)
    .filter(Boolean);

  let installationUsage = 0;
  if (installationIds.length > 0) {
    const { count } = await supabase
      .from("skill_note_attachments")
      .select("id", { count: "exact", head: true })
      .in("skill_installation_id", installationIds)
      .eq("is_active", true);
    installationUsage = count || 0;
  }

  const { count: ownedUsage } = await supabase
    .from("skill_note_attachments")
    .select("id", { count: "exact", head: true })
    .eq("skill_note_id", skillId)
    .eq("is_active", true);

  return installationUsage + (ownedUsage || 0);
}

export async function enrichSkillForUser(
  skill: SkillRecord,
  userId: string,
): Promise<SkillRecord> {
  const latest = await getLatestSkillVersion(skill.id as string);
  const installation = await getActiveInstallation(skill.id as string, userId);
  const latestVersionId = (skill.current_published_version_id as string | null) || (latest?.id as string | undefined) || null;
  const latestVersionNumber = latest?.version_number as number | undefined;
  const installedVersionNumber = await getVersionNumber(installation?.installed_version_id as string | undefined);

  let relationship = "not_installed";
  if (skill.owner_id === userId) relationship = "owner";
  else if (installation && installation.installed_version_id === latestVersionId) relationship = "installed_current";
  else if (installation) relationship = "installed_stale";

  return {
    ...skill,
    latest_version_id: latestVersionId,
    latest_version_number: latestVersionNumber || null,
    installation_id: installation?.id,
    installed_version_id: installation?.installed_version_id,
    installed_version_number: installedVersionNumber,
    relationship,
    has_update: relationship === "installed_stale",
    install_count: await countActiveInstallations(skill.id as string),
    active_usage_count: await countActiveUsage(skill.id as string),
    deprecated: skill.status === "archived",
  };
}
