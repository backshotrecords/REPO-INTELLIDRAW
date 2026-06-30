import type { VercelRequest, VercelResponse } from "@vercel/node";
import bcrypt from "bcryptjs";
import { createToken } from "../lib/auth.js";
import { DEFAULT_CANVAS_TITLE, DEFAULT_MERMAID_CODE } from "../lib/defaultCanvas.js";
import { supabase } from "../lib/db.js";
import {
  getSignupMaxFailedAttempts,
  getSignupVerificationRecord,
  hashSignupToken,
  incrementSignupFailedAttempts,
  isSignupTokenExpired,
  markSignupTokenUsed,
  openSignupPayload,
} from "../lib/signupVerification.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    return validateSignupLink(req, res);
  }

  if (req.method === "POST") {
    return completeSignup(req, res);
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function validateSignupLink(req: VercelRequest, res: VercelResponse) {
  const token = readQueryString(req.query.token);
  const sealedPayload = readQueryString(req.query.payload);

  if (!token || !sealedPayload) {
    return res.status(400).json({ error: "Verification link is missing required data" });
  }

  try {
    const tokenHash = hashSignupToken(token);
    const record = await getSignupVerificationRecord(tokenHash);
    if (!record || record.used_at || isSignupTokenExpired(record.expires_at)) {
      return res.status(400).json({ error: "Verification link is invalid or expired" });
    }

    const payload = openSignupPayload(sealedPayload);
    if (payload.tokenHash !== tokenHash || payload.expiresAt !== record.expires_at) {
      return res.status(400).json({ error: "Verification link is invalid or expired" });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Signup verification link check error:", err);
    return res.status(400).json({ error: "Verification link is invalid or expired" });
  }
}

async function completeSignup(req: VercelRequest, res: VercelResponse) {
  const { token, payload: sealedPayload, password } = req.body || {};

  if (
    typeof token !== "string" ||
    typeof sealedPayload !== "string" ||
    typeof password !== "string"
  ) {
    return res.status(400).json({ error: "Token, signup payload, and password are required" });
  }

  try {
    const tokenHash = hashSignupToken(token);
    const record = await getSignupVerificationRecord(tokenHash);

    if (!record || record.used_at || isSignupTokenExpired(record.expires_at)) {
      return res.status(400).json({ error: "Verification link is invalid or expired" });
    }

    if (record.failed_attempts >= getSignupMaxFailedAttempts()) {
      return res.status(429).json({ error: "Too many password attempts. Please start over." });
    }

    const payload = openSignupPayload(sealedPayload);
    if (payload.tokenHash !== tokenHash || payload.expiresAt !== record.expires_at) {
      return res.status(400).json({ error: "Verification link is invalid or expired" });
    }

    if (isSignupTokenExpired(payload.expiresAt)) {
      return res.status(400).json({ error: "Verification link is invalid or expired" });
    }

    const passwordMatches = await bcrypt.compare(password, payload.passwordHash);
    if (!passwordMatches) {
      const failedAttempts = await incrementSignupFailedAttempts(record.id);
      const attemptsRemaining = Math.max(
        getSignupMaxFailedAttempts() - failedAttempts,
        0
      );
      return res.status(401).json({
        error: attemptsRemaining > 0
          ? "That password does not match the original signup password"
          : "Too many password attempts. Please start over.",
        attemptsRemaining,
      });
    }

    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", payload.email)
      .single();

    if (existingUser) {
      await markSignupTokenUsed(record.id);
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    await markSignupTokenUsed(record.id);

    const { data: user, error: insertError } = await supabase
      .from("users")
      .insert({
        email: payload.email,
        password_hash: payload.passwordHash,
        display_name: payload.displayName,
      })
      .select("id, email, display_name")
      .single();

    if (insertError || !user) {
      console.error("Signup verification create user error:", insertError);
      return res.status(500).json({ error: "Failed to create account. Please start over." });
    }

    await supabase.from("canvases").insert({
      user_id: user.id,
      title: DEFAULT_CANVAS_TITLE,
      mermaid_code: DEFAULT_MERMAID_CODE,
      chat_history: [],
    });

    const authToken = await createToken({ userId: user.id, email: user.email });
    return res.status(201).json({
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
      },
    });
  } catch (err) {
    console.error("Complete signup verification error:", err);
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Verification link is invalid or expired",
    });
  }
}

function readQueryString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}
