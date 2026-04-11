import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = authPayload.userId;

  // PUT /api/settings/apikey — Save or update OpenAI API key
  if (req.method === "PUT") {
    const { apiKey } = req.body || {};

    if (!apiKey) {
      return res.status(400).json({ error: "API key is required" });
    }

    try {
      const encryptedKey = encrypt(apiKey);

      const { error } = await supabase
        .from("users")
        .update({ api_key_encrypted: encryptedKey })
        .eq("id", userId);

      if (error) {
        return res.status(500).json({ error: "Failed to save API key" });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Save API key error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // GET /api/settings/apikey — Get the raw API key (for show/copy functionality)
  if (req.method === "GET") {
    try {
      const { data: user } = await supabase
        .from("users")
        .select("api_key_encrypted")
        .eq("id", userId)
        .single();

      if (!user?.api_key_encrypted) {
        return res.status(200).json({ apiKey: null });
      }

      const rawKey = decrypt(user.api_key_encrypted);
      return res.status(200).json({ apiKey: rawKey });
    } catch (err) {
      console.error("Get API key error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // DELETE /api/settings/apikey — Remove the API key
  if (req.method === "DELETE") {
    try {
      const { error } = await supabase
        .from("users")
        .update({ api_key_encrypted: null })
        .eq("id", userId);

      if (error) {
        return res.status(500).json({ error: "Failed to delete API key" });
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Delete API key error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
