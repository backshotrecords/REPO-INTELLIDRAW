import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";

const DEFAULT_COMMUNITY_ACCESS_CONFIG = {
  enabled: true,
  whatsappCommunityUrl: "https://chat.whatsapp.com/Jr1BYruwnVbKxv8iwJ6aQo",
  memberCountLabel: "+84",
  memberCopy: "Over 80+ active creators inside",
};

const COMMUNITY_ACCESS_KEYS = [
  "community_access_enabled",
  "whatsapp_community_url",
  "community_member_count_label",
  "community_member_copy",
];

function isMissingApiKeyRequestColumns(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    error?.message?.includes("api_key_request_")
  );
}

async function getCommunityAccessConfig() {
  const config = {
    ...DEFAULT_COMMUNITY_ACCESS_CONFIG,
    whatsappCommunityUrl:
      process.env.WHATSAPP_COMMUNITY_URL ||
      process.env.VITE_WHATSAPP_COMMUNITY_URL ||
      DEFAULT_COMMUNITY_ACCESS_CONFIG.whatsappCommunityUrl,
  };

  try {
    const { data: rows } = await supabase
      .from("admin_config")
      .select("key, value")
      .in("key", COMMUNITY_ACCESS_KEYS);

    const cfg: Record<string, string> = {};
    for (const row of rows || []) cfg[row.key] = row.value;

    return {
      enabled: (cfg.community_access_enabled ?? String(config.enabled)) === "true",
      whatsappCommunityUrl: cfg.whatsapp_community_url || config.whatsappCommunityUrl,
      memberCountLabel: cfg.community_member_count_label || config.memberCountLabel,
      memberCopy: cfg.community_member_copy || config.memberCopy,
    };
  } catch {
    return config;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/settings — Get user profile + masked API key
  if (req.method === "GET") {
    try {
      let { data: user, error } = await supabase
        .from("users")
        .select("id, email, display_name, api_key_encrypted, api_key_source, active_model_id, api_key_request_status, api_key_requested_at, api_key_request_channel")
        .eq("id", userId)
        .single();

      if (isMissingApiKeyRequestColumns(error)) {
        const fallback = await supabase
          .from("users")
          .select("id, email, display_name, api_key_encrypted, api_key_source, active_model_id")
          .eq("id", userId)
          .single();
        user = fallback.data
          ? {
              ...fallback.data,
              api_key_request_status: "none",
              api_key_requested_at: null,
              api_key_request_channel: null,
            }
          : null;
        error = fallback.error;
      }

      if (error || !user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Mask the API key for display (show first 7 + last 4 chars)
      let maskedKey = null;
      let rawKey = null;
      if (user.api_key_encrypted) {
        try {
          rawKey = decrypt(user.api_key_encrypted);
          if (rawKey.length > 11) {
            maskedKey = rawKey.slice(0, 7) + "•".repeat(rawKey.length - 11) + rawKey.slice(-4);
          } else {
            maskedKey = "•".repeat(rawKey.length);
          }
        } catch {
          maskedKey = "••••••••••••";
        }
      }

      return res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          activeModelId: user.active_model_id,
          hasApiKey: !!user.api_key_encrypted,
          apiKeySource: user.api_key_source || "user",
          apiKeyManagedByAdmin: user.api_key_source === "admin",
          apiKeyRequestStatus: user.api_key_request_status || "none",
          apiKeyRequestedAt: user.api_key_requested_at,
          apiKeyRequestChannel: user.api_key_request_channel,
          maskedApiKey: maskedKey,
        },
        communityAccess: await getCommunityAccessConfig(),
      });
    } catch (err) {
      console.error("Get settings error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // PUT /api/settings — Update profile
  if (req.method === "PUT") {
    const { displayName, email } = req.body || {};

    try {
      const updateData: Record<string, unknown> = {};
      if (displayName !== undefined) {
        if (typeof displayName !== "string" || !displayName.trim()) {
          return res.status(400).json({ error: "Please enter your full name before saving account settings." });
        }
        updateData.display_name = displayName.trim();
      }
      if (email !== undefined) updateData.email = email.toLowerCase();

      const { data, error } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", userId)
        .select("id, email, display_name")
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to update profile" });
      }

      return res.status(200).json({
        user: {
          id: data.id,
          email: data.email,
          displayName: data.display_name,
        },
      });
    } catch (err) {
      console.error("Update settings error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
