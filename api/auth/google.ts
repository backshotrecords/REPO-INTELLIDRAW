import type { VercelRequest, VercelResponse } from "@vercel/node";
import { decodeJwt } from "jose";
import { supabase } from "../lib/db.js";
import { createToken } from "../lib/auth.js";

const GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, redirectUri } = req.body;

  if (!code || !redirectUri) {
    return res.status(400).json({ error: "Authorization code and redirect URI are required" });
  }

  try {
    // 1. Exchange the authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.id_token) {
      console.error("Google token exchange failed:", tokenData);
      return res.status(401).json({ error: "Failed to authenticate with Google" });
    }

    // 2. Decode the id_token to get user info
    //    (safe to decode without verification since we got it directly from Google's token endpoint)
    const claims = decodeJwt(tokenData.id_token);
    const email = (claims.email as string)?.toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Could not retrieve email from Google account" });
    }

    // 3. Find existing user by email
    const { data: existingUser } = await supabase
      .from("users")
      .select("id, email, display_name, active_model_id, is_global_admin, is_banned")
      .eq("email", email)
      .single();

    if (existingUser) {
      // Check if user is banned
      if (existingUser.is_banned) {
        return res.status(403).json({ error: "Your account has been suspended. Please contact an administrator." });
      }

      // Existing user — auto-link: just log them in
      const token = await createToken({ userId: existingUser.id, email: existingUser.email });

      return res.status(200).json({
        token,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          displayName: existingUser.display_name,
          activeModelId: existingUser.active_model_id,
          isGlobalAdmin: existingUser.is_global_admin,
        },
      });
    }

    return res.status(404).json({
      error: "No account exists for this Google email. Please create an account with email verification first.",
    });
  } catch (err) {
    console.error("Google auth error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
