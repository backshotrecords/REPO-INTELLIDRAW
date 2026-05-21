import { supabase } from "./db.js";

type SkillAttachment = {
  skill_note_id: string;
  user_id: string;
  scope: "local" | "global";
};

async function getStarTargetSkillId(skillNoteId: string): Promise<string> {
  const { data } = await supabase
    .from("skill_notes")
    .select("source_skill_id")
    .eq("id", skillNoteId)
    .single();

  return ((data?.source_skill_id as string | null) || skillNoteId);
}

async function getUserCanvasCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("canvases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    console.error("Failed to count canvases for skill stars:", error);
    return 0;
  }

  return count || 0;
}

async function getLineageSkillIds(skillId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("skill_notes")
    .select("id")
    .or(`id.eq.${skillId},source_skill_id.eq.${skillId}`);

  if (error) {
    console.error("Failed to load skill lineage for stars:", error);
    return [skillId];
  }

  const ids = (data || []).map((row: Record<string, unknown>) => row.id as string).filter(Boolean);
  return ids.length > 0 ? ids : [skillId];
}

export async function recalculateSkillStars(skillId: string): Promise<number> {
  const targetSkillId = await getStarTargetSkillId(skillId);
  const lineageIds = await getLineageSkillIds(targetSkillId);

  const { data: attachments, error } = await supabase
    .from("skill_note_attachments")
    .select("skill_note_id, user_id, scope")
    .in("skill_note_id", lineageIds)
    .eq("is_active", true);

  if (error) {
    console.error("Failed to load active skill attachments for stars:", error);
    return 0;
  }

  const canvasCounts = new Map<string, number>();
  let stars = 0;

  for (const attachment of (attachments || []) as SkillAttachment[]) {
    if (attachment.scope === "local") {
      stars += 1;
      continue;
    }

    if (!canvasCounts.has(attachment.user_id)) {
      canvasCounts.set(attachment.user_id, await getUserCanvasCount(attachment.user_id));
    }
    stars += canvasCounts.get(attachment.user_id) || 0;
  }

  const { error: updateError } = await supabase
    .from("skill_notes")
    .update({ stars })
    .eq("id", targetSkillId);

  if (updateError) {
    console.error("Failed to update skill stars:", updateError);
  }

  return stars;
}

export async function recalculateSkillStarsForAttachments(
  attachments: Array<{ skill_note_id: string } | null | undefined>,
): Promise<void> {
  const targetIds = new Set<string>();

  for (const attachment of attachments) {
    if (!attachment?.skill_note_id) continue;
    targetIds.add(await getStarTargetSkillId(attachment.skill_note_id));
  }

  await Promise.all([...targetIds].map(skillId => recalculateSkillStars(skillId)));
}

export async function recalculateGlobalSkillStarsForUser(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("skill_note_attachments")
    .select("skill_note_id")
    .eq("user_id", userId)
    .eq("scope", "global")
    .eq("is_active", true);

  if (error) {
    console.error("Failed to load global skill attachments for stars:", error);
    return;
  }

  await recalculateSkillStarsForAttachments((data || []) as Array<{ skill_note_id: string }>);
}
