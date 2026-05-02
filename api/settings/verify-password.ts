import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { authenticateRequest } from "../lib/auth.js";
import { supabase } from "../lib/db.js";

/**
 * POST /api/settings/verify-password
 * Checks whether the supplied password matches the current user's hash.
 * Used for real-time "old password correct" indicator on the settings page.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authPayload = await authenticateRequest(req);
  if (!authPayload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", authPayload.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    return res.status(200).json({ valid });
  } catch (err) {
    console.error("Verify-password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
