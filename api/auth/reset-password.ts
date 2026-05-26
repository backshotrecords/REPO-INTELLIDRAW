import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { supabase } from "../lib/db.js";
import {
  getValidPasswordResetRecord,
  markResetTokenUsed,
} from "../lib/passwordReset.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { token, newPassword } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Reset token is required" });
    }

    if (!newPassword || typeof newPassword !== "string") {
      return res.status(400).json({ error: "New password is required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const resetRecord = await getValidPasswordResetRecord(token);
    if (!resetRecord) {
      return res
        .status(400)
        .json({ error: "Invalid or expired reset link" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, is_banned")
      .eq("id", resetRecord.user_id)
      .single();

    if (userError || !user || user.is_banned) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    await markResetTokenUsed(resetRecord.id);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: passwordHash,
        password_changed_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Password reset update failed:", updateError);
      return res.status(500).json({ error: "Failed to reset password" });
    }

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (err) {
    console.error("Reset-password error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
