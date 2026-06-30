import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { cascadeDeleteUser } from "../lib/delete-user.js";
import { ensureEntitlementSchema } from "../lib/entitlements.js";

function isMissingApiKeyRequestColumns(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.message?.includes("api_key_request_")
  );
}

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
      let { data: users, error } = await supabase
        .from("users")
        .select("id, email, display_name, is_banned, is_global_admin, created_at, api_key_encrypted, api_key_source, api_key_request_status, api_key_requested_at, api_key_request_channel")
        .order("created_at", { ascending: false });

      if (isMissingApiKeyRequestColumns(error)) {
        const fallback = await supabase
          .from("users")
          .select("id, email, display_name, is_banned, is_global_admin, created_at, api_key_encrypted, api_key_source")
          .order("created_at", { ascending: false });
        users = fallback.data?.map((u: Record<string, unknown>) => ({
          ...u,
          api_key_request_status: "none",
          api_key_requested_at: null,
          api_key_request_channel: null,
        }));
        error = fallback.error;
      }

      if (error) {
        return res.status(500).json({ error: error.message || "Failed to fetch users" });
      }

      // Fetch canvas counts per user
      const userIds = (users || []).map((u: Record<string, unknown>) => u.id as string);
      let canvasCounts: Record<string, number> = {};
      const subscriptionByUserId = new Map<string, { plan_id: string; status: string }>();
      const planNameById = new Map<string, string>([["free", "Free"]]);

      if (userIds.length > 0) {
        const { data: canvases } = await supabase
          .from("canvases")
          .select("user_id");

        if (canvases) {
          for (const c of canvases as Array<{ user_id: string }>) {
            canvasCounts[c.user_id] = (canvasCounts[c.user_id] || 0) + 1;
          }
        }

        try {
          await ensureEntitlementSchema();
          const { data: plans } = await supabase
            .from("subscription_plans")
            .select("id, name");
          for (const plan of (plans || []) as Array<{ id: string; name: string }>) {
            planNameById.set(plan.id, plan.name);
          }

          const { data: subscriptions } = await supabase
            .from("user_subscriptions")
            .select("user_id, plan_id, status")
            .in("user_id", userIds);
          for (const subscription of (subscriptions || []) as Array<{ user_id: string; plan_id: string; status: string }>) {
            subscriptionByUserId.set(subscription.user_id, subscription);
          }
        } catch (entitlementErr) {
          console.error("Failed to load user subscription plans:", entitlementErr);
        }
      }

      const usersWithCounts = (users || []).map((u: Record<string, unknown>) => ({
        subscription_plan_id: subscriptionByUserId.get(u.id as string)?.plan_id || "free",
        subscription_plan_name: planNameById.get(subscriptionByUserId.get(u.id as string)?.plan_id || "free") || "Free",
        subscription_status: subscriptionByUserId.get(u.id as string)?.status || "active",
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        is_banned: u.is_banned,
        is_global_admin: u.is_global_admin,
        created_at: u.created_at,
        api_key_source: u.api_key_source || "user",
        api_key_request_status: u.api_key_request_status || "none",
        api_key_requested_at: u.api_key_requested_at || null,
        api_key_request_channel: u.api_key_request_channel || null,
        has_api_key: !!u.api_key_encrypted,
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
