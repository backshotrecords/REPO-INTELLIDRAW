import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { cascadeDeleteUser } from "../lib/delete-user.js";

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

      // Use shared cascading delete helper
      const result = await cascadeDeleteUser(userId);

      return res.status(200).json({
        success: true,
        deleted_email: result.deleted_email,
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
