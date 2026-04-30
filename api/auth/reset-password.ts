import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Reset token is required" });
    }

    // Find user by reset token
    const { data: user, error: lookupError } = await supabase
      .from("users")
      .select("id")
      .eq("reset_token", token)
      .single();

    if (lookupError || !user) {
      return res
        .status(400)
        .json({ error: "Invalid or expired reset link" });
    }

    // Hash the default password
    const passwordHash = await bcrypt.hash("password", 12);

    // Update password and clear the token (single-use)
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: passwordHash, reset_token: null })
      .eq("id", user.id);

    if (updateError) {
      console.error("Password reset update failed:", updateError);
      return res.status(500).json({ error: "Failed to reset password" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Reset-password error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
