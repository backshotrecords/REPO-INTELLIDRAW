import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new passwords are required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  try {
    // Fetch user's current password hash
    const { data: user, error: fetchError } = await supabase
      .from("users")
      .select("id, password_hash")
      .eq("id", authPayload.userId)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify old password
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 12);

    // Update
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: newHash })
      .eq("id", authPayload.userId);

    if (updateError) {
      console.error("Password update failed:", updateError);
      return res.status(500).json({ error: "Failed to update password" });
    }

    return res.status(200).json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    console.error("Change-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
