import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { decrypt } from "../lib/crypto.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // GET /api/settings — Get user profile + masked API key
  if (req.method === "GET") {
    try {
      const { data: user } = await supabase
        .from("users")
        .select("id, email, display_name, api_key_encrypted, active_model_id")
        .eq("id", userId)
        .single();

      if (!user) {
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
          maskedApiKey: maskedKey,
        },
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
      if (displayName !== undefined) updateData.display_name = displayName;
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
