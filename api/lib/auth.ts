import { SignJWT, jwtVerify } from "jose";
import type { VercelRequest } from "@vercel/node";
import { supabase } from "./db.js";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "intellidraw-jwt-secret-change-in-prod"
);

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Create a signed JWT token for a user session.
 * Tokens expire in 7 days.
 */
export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT token.
 * Returns the payload or null if invalid/expired.
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Extract the Bearer token from an Authorization header.
 */
export function extractToken(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * Middleware-style function: authenticates a request and returns the user payload.
 * Returns null if unauthenticated.
 */
export async function authenticateRequest(
  req: VercelRequest
): Promise<JWTPayload | null> {
  const token = extractToken(req);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  const { data: user, error } = await supabase
    .from("users")
    .select("password_changed_at")
    .eq("id", payload.userId)
    .single();

  if (error) {
    const missingPasswordChangedAt =
      error.code === "42703" ||
      error.message?.includes("password_changed_at");
    if (missingPasswordChangedAt) return payload;
    return null;
  }
  if (!user) return null;

  if (user?.password_changed_at && payload.iat) {
    const issuedAtMs = payload.iat * 1000;
    const changedAtMs = new Date(user.password_changed_at).getTime();
    if (issuedAtMs < changedAtMs) return null;
  }

  return payload;
}
