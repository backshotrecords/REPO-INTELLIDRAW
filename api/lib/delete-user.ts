import { supabase } from "./db.js";

/**
 * Cascade-delete all data associated with a user, then delete the user row.
 * Shared by both the admin delete endpoint and the self-delete endpoint.
 *
 * Returns the deleted user's email on success, or throws on failure.
 */
export async function cascadeDeleteUser(userId: string): Promise<{ deleted_email: string; deleted_name: string }> {
  // Verify target user exists
  const { data: targetUser, error: lookupError } = await supabase
    .from("users")
    .select("id, email, display_name")
    .eq("id", userId)
    .single();

  if (lookupError || !targetUser) {
    throw new Error("User not found");
  }

  // ── Cascade delete in dependency order ──────────────

  // 1. Skill note attachments (references skill_notes + canvases)
  const { data: userSkills } = await supabase
    .from("skill_notes")
    .select("id")
    .eq("owner_id", userId);

  const skillIds = (userSkills || []).map((s: Record<string, unknown>) => s.id as string);

  if (skillIds.length > 0) {
    await supabase
      .from("skill_note_attachments")
      .delete()
      .in("skill_note_id", skillIds);

    // 2. Skill note shares (references skill_notes)
    await supabase
      .from("skill_note_shares")
      .delete()
      .in("skill_note_id", skillIds);
  }

  // Also delete attachments where user attached someone else's skill to their own canvas
  const { data: userCanvases } = await supabase
    .from("canvases")
    .select("id")
    .eq("user_id", userId);

  const canvasIds = (userCanvases || []).map((c: Record<string, unknown>) => c.id as string);

  if (canvasIds.length > 0) {
    await supabase
      .from("skill_note_attachments")
      .delete()
      .in("canvas_id", canvasIds);

    // 3. Canvas commits (references canvases)
    await supabase
      .from("canvas_commits")
      .delete()
      .in("canvas_id", canvasIds);
  }

  // 4. Skill notes (references users)
  if (skillIds.length > 0) {
    await supabase
      .from("skill_notes")
      .delete()
      .eq("owner_id", userId);
  }

  // 5. Canvases (references users — may cascade, but be explicit)
  await supabase
    .from("canvases")
    .delete()
    .eq("user_id", userId);

  // 6. Group members (references users + user_groups)
  await supabase
    .from("group_members")
    .delete()
    .eq("user_id", userId);

  // 7. User groups owned by this user — first remove members, then groups
  const { data: ownedGroups } = await supabase
    .from("user_groups")
    .select("id")
    .eq("owner_id", userId);

  const groupIds = (ownedGroups || []).map((g: Record<string, unknown>) => g.id as string);

  if (groupIds.length > 0) {
    await supabase
      .from("group_members")
      .delete()
      .in("group_id", groupIds);

    await supabase
      .from("user_groups")
      .delete()
      .eq("owner_id", userId);
  }

  // 8. User onboarding state
  await supabase
    .from("user_onboarding_state")
    .delete()
    .eq("user_id", userId);

  // 9. AI models (references users — may cascade, but be explicit)
  await supabase
    .from("ai_models")
    .delete()
    .eq("user_id", userId);

  // 10. Shares where this user was the recipient
  await supabase
    .from("skill_note_shares")
    .delete()
    .eq("shared_with_user_id", userId);

  // 11. Finally, delete the user row
  const { error: deleteError } = await supabase
    .from("users")
    .delete()
    .eq("id", userId);

  if (deleteError) {
    console.error("Failed to delete user:", deleteError);
    throw new Error(deleteError.message || "Failed to delete user");
  }

  return {
    deleted_email: targetUser.email as string,
    deleted_name: (targetUser.display_name as string) || "",
  };
}
