import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { isEntitlementError, recordFeatureUsage, requireFeatureQuota, sendEntitlementError } from "../lib/entitlements.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireFeatureQuota(authPayload.userId, "managed_api_key.request");

    const { data: currentUser, error: fetchError } = await supabase
      .from("users")
      .select("api_key_encrypted")
      .eq("id", authPayload.userId)
      .single();

    if (fetchError) {
      return res.status(500).json({ error: fetchError.message || "Failed to load user" });
    }

    const requestedAt = new Date().toISOString();
    const status = currentUser?.api_key_encrypted ? "fulfilled" : "requested";

    const { data: user, error } = await supabase
      .from("users")
      .update({
        api_key_request_status: status,
        api_key_requested_at: requestedAt,
        api_key_request_channel: "whatsapp",
      })
      .eq("id", authPayload.userId)
      .select("api_key_request_status, api_key_requested_at, api_key_request_channel")
      .single();

    if (error) {
      return res.status(500).json({ error: error.message || "Failed to record API key request" });
    }
    await recordFeatureUsage(authPayload.userId, "managed_api_key.request", 1, {
      status,
    });

    return res.status(200).json({
      success: true,
      apiKeyRequestStatus: user.api_key_request_status,
      apiKeyRequestedAt: user.api_key_requested_at,
      apiKeyRequestChannel: user.api_key_request_channel,
    });
  } catch (err) {
    if (isEntitlementError(err)) return sendEntitlementError(res, err);
    console.error("API key request error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
