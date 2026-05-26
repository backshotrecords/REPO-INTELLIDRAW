import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabase } from "../lib/db.js";
import {
  buildResetUrl,
  createPasswordResetToken,
} from "../lib/passwordReset.js";
import { sendPasswordResetEmail } from "../lib/email.js";

const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const { data: user } = await supabase
      .from("users")
      .select("id, email, display_name, is_banned")
      .eq("email", normalizedEmail)
      .single();

    if (!user || user.is_banned) {
      return res.status(200).json({ success: true, message: GENERIC_MESSAGE });
    }

    const { token } = await createPasswordResetToken({
      userId: user.id,
      source: "self_service",
    });
    const resetUrl = buildResetUrl(req, token);

    await sendPasswordResetEmail({
      to: user.email,
      displayName: user.display_name,
      resetUrl,
    });

    return res.status(200).json({ success: true, message: GENERIC_MESSAGE });
  } catch (err) {
    console.error("Request password reset error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
