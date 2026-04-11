import { SignJWT, jwtVerify } from "jose";
import type { VercelRequest } from "@vercel/node";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "intellidraw-jwt-secret-change-in-prod"
);

export interface JWTPayload {
  userId: string;
  email: string;
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
  return verifyToken(token);
}
