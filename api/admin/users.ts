import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Authenticate
    const authPayload = await authenticateRequest(req);
    if (!authPayload) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Admin check
    const { data: admin } = await supabase
      .from("users")
      .select("is_global_admin")
      .eq("id", authPayload.userId)
      .single();

    if (!admin?.is_global_admin) {
      return res.status(403).json({ error: "Forbidden: Admins only" });
    }

    // ── GET: List all users ─────────────────────────────────
    if (req.method === "GET") {
      const { data: users, error } = await supabase
        .from("users")
        .select("id, email, display_name, is_banned, is_global_admin, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({ error: error.message || "Failed to fetch users" });
      }

      // Fetch canvas counts per user
      const userIds = (users || []).map((u: Record<string, unknown>) => u.id as string);
      let canvasCounts: Record<string, number> = {};

      if (userIds.length > 0) {
        const { data: canvases } = await supabase
          .from("canvases")
          .select("user_id");

        if (canvases) {
          for (const c of canvases as Array<{ user_id: string }>) {
            canvasCounts[c.user_id] = (canvasCounts[c.user_id] || 0) + 1;
          }
        }
      }

      const usersWithCounts = (users || []).map((u: Record<string, unknown>) => ({
        ...u,
        canvas_count: canvasCounts[u.id as string] || 0,
      }));

      return res.status(200).json({ users: usersWithCounts });
    }

    // ── PUT: Ban/Unban a user ───────────────────────────────
    if (req.method === "PUT") {
      const { userId, is_banned } = req.body || {};

      if (!userId || typeof is_banned !== "boolean") {
        return res.status(400).json({ error: "userId and is_banned (boolean) are required" });
      }

      // Prevent self-ban
      if (userId === authPayload.userId) {
        return res.status(400).json({ error: "Cannot modify your own account" });
      }

      const { error } = await supabase
        .from("users")
        .update({ is_banned })
        .eq("id", userId);

      if (error) {
        return res.status(500).json({ error: error.message || "Failed to update user" });
      }

      return res.status(200).json({ success: true, is_banned });
    }

    // ── DELETE: Delete a user and all associated data ────────
    if (req.method === "DELETE") {
      const userId = (req.query.userId as string) || (req.body?.userId as string);

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      // Prevent self-delete
      if (userId === authPayload.userId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      // Verify target user exists
      const { data: targetUser, error: lookupError } = await supabase
        .from("users")
        .select("id, email")
        .eq("id", userId)
        .single();

      if (lookupError || !targetUser) {
        return res.status(404).json({ error: "User not found" });
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
        return res.status(500).json({ error: deleteError.message || "Failed to delete user" });
      }

      return res.status(200).json({
        success: true,
        deleted_email: targetUser.email,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Admin users API error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
