import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";
import {
  buildResetUrl,
  createPasswordResetToken,
} from "../lib/passwordReset.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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

    const { email } = req.body || {};
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }

    // Look up the target user
    const { data: targetUser, error: lookupError } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", email.toLowerCase().trim())
      .single();

    if (lookupError || !targetUser) {
      return res.status(404).json({ error: "No user found with that email" });
    }

    const { token } = await createPasswordResetToken({
      userId: targetUser.id,
      source: "admin",
      createdByAdmin: authPayload.userId,
    });
    const resetLink = buildResetUrl(req, token);

    return res.status(200).json({
      success: true,
      email: targetUser.email,
      resetLink,
    });
  } catch (err) {
    console.error("Admin reset-password error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
