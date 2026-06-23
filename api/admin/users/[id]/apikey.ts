import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../../../lib/auth.js";
import { encrypt } from "../../../lib/crypto.js";
import { supabase } from "../../../lib/db.js";

function isMissingApiKeyRequestColumns(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.message?.includes("api_key_request_")
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const authPayload = await authenticateRequest(req);
    if (!authPayload) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.method !== "PUT") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { data: admin } = await supabase
      .from("users")
      .select("is_global_admin")
      .eq("id", authPayload.userId)
      .single();

    if (!admin?.is_global_admin) {
      return res.status(403).json({ error: "Forbidden: Admins only" });
    }

    const targetUserId = req.query.id;
    if (!targetUserId || typeof targetUserId !== "string") {
      return res.status(400).json({ error: "Missing target user id" });
    }

    if (targetUserId === authPayload.userId) {
      return res.status(400).json({ error: "Use Settings to manage your own API key" });
    }

    const { apiKey } = req.body || {};
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "API key is required" });
    }

    const encryptedKey = encrypt(apiKey.trim());
    let { data: user, error } = await supabase
      .from("users")
      .update({
        api_key_encrypted: encryptedKey,
        api_key_source: "admin",
        api_key_updated_at: new Date().toISOString(),
        api_key_managed_by: authPayload.userId,
        api_key_request_status: "fulfilled",
      })
      .eq("id", targetUserId)
      .select("id, email, display_name, is_banned, is_global_admin, created_at, api_key_source, api_key_request_status, api_key_requested_at, api_key_request_channel")
      .single();

    if (isMissingApiKeyRequestColumns(error)) {
      const fallback = await supabase
        .from("users")
        .update({
          api_key_encrypted: encryptedKey,
          api_key_source: "admin",
          api_key_updated_at: new Date().toISOString(),
          api_key_managed_by: authPayload.userId,
        })
        .eq("id", targetUserId)
        .select("id, email, display_name, is_banned, is_global_admin, created_at, api_key_source")
        .single();

      user = fallback.data
        ? {
            ...fallback.data,
            api_key_request_status: "fulfilled",
            api_key_requested_at: null,
            api_key_request_channel: null,
          }
        : null;
      error = fallback.error;
    }

    if (error) {
      return res.status(500).json({ error: error.message || "Failed to save API key" });
    }

    return res.status(200).json({
      success: true,
      user: {
        ...user,
        has_api_key: true,
      },
    });
  } catch (err) {
    console.error("Admin user API key error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
