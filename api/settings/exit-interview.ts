import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/db.js";

/**
 * POST /api/settings/exit-interview
 *
 * Unauthenticated — the user's account is already deleted when they submit.
 * Stores the exit interview reason in the exit_interviews table.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, name, reason } = req.body || {};

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ error: "Reason is required" });
    }

    const { error } = await supabase.from("exit_interviews").insert({
      user_email: email.trim(),
      user_name: (typeof name === "string" ? name.trim() : "") || "Unknown",
      reason: reason.trim(),
    });

    if (error) {
      console.error("Failed to save exit interview:", error);
      return res.status(500).json({ error: error.message || "Failed to save exit interview" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Exit interview error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
