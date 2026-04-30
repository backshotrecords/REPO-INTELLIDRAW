import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

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

    // Generate a reset token
    const resetToken = crypto.randomUUID();

    // Store token on the user row
    const { error: updateError } = await supabase
      .from("users")
      .update({ reset_token: resetToken })
      .eq("id", targetUser.id);

    if (updateError) {
      console.error("Failed to store reset token:", updateError);
      return res.status(500).json({ error: "Failed to generate reset link" });
    }

    // Build the reset link (relative — frontend will resolve to full URL)
    const resetLink = `/reset-password?token=${resetToken}`;

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
