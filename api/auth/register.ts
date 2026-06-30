import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { supabase } from "../lib/db.js";
import { sendSignupVerificationEmail } from "../lib/email.js";
import {
  buildSignupVerificationUrl,
  createSignupPayload,
  createSignupVerificationRecord,
  generateSignupToken,
  getSignupExpiry,
  hashSignupToken,
  sealSignupPayload,
} from "../lib/signupVerification.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, password, displayName } = req.body || {};

  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "Email, password, and display name are required" });
  }

  if (typeof email !== "string" || typeof password !== "string" || typeof displayName !== "string") {
    return res.status(400).json({ error: "Email, password, and display name are required" });
  }

  if (!displayName.trim()) {
    return res.status(400).json({ error: "Display name is required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    const token = generateSignupToken();
    const tokenHash = hashSignupToken(token);
    const expiresAt = getSignupExpiry().toISOString();

    await createSignupVerificationRecord({ tokenHash, expiresAt });

    const payload = sealSignupPayload(createSignupPayload({
      email: normalizedEmail,
      displayName: displayName.trim(),
      passwordHash,
      tokenHash,
      expiresAt,
    }));
    const verificationUrl = buildSignupVerificationUrl(req, token, payload);

    await sendSignupVerificationEmail({
      to: normalizedEmail,
      displayName: displayName.trim(),
      verificationUrl,
    });

    return res.status(202).json({
      success: true,
      message: "Check your email to verify your signup. The link expires in 5 minutes.",
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
