import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, display_name, active_model_id, api_key_encrypted, is_global_admin")
      .eq("id", authPayload.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        activeModelId: user.active_model_id,
        hasApiKey: !!user.api_key_encrypted,
        isGlobalAdmin: user.is_global_admin,
      },
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
