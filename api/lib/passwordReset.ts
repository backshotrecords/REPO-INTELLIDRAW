import crypto from "crypto";
import type { VercelRequest } from "@vercel/node";
import { supabase } from "./db.js";

const DEFAULT_RESET_TOKEN_TTL_MINUTES = 60;

export type PasswordResetSource = "self_service" | "admin";

export interface PasswordResetRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
}

export function getResetTokenTtlMinutes(): number {
  const configured = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_RESET_TOKEN_TTL_MINUTES;
  }
  return Math.min(configured, 24 * 60);
}

export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getResetExpiry(now = new Date()): Date {
  return new Date(now.getTime() + getResetTokenTtlMinutes() * 60 * 1000);
}

export function isResetExpired(expiresAt: string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function getAppBaseUrl(req: VercelRequest): string {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin.replace(/\/$/, "");

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const hostValue = Array.isArray(host) ? host[0] : host;
  const protocolValue = Array.isArray(protocol) ? protocol[0] : protocol;

  if (hostValue) {
    return `${protocolValue}://${hostValue}`.replace(/\/$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  }

  throw new Error("Unable to determine reset link origin");
}

export function buildResetUrl(req: VercelRequest, token: string): string {
  const url = new URL(
    `/reset-password/${encodeURIComponent(token)}`,
    getAppBaseUrl(req)
  );
  return url.toString();
}

export async function createPasswordResetToken(opts: {
  userId: string;
  source: PasswordResetSource;
  createdByAdmin?: string | null;
}) {
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = getResetExpiry().toISOString();

  await supabase
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", opts.userId)
    .is("used_at", null);

  const { data, error } = await supabase
    .from("password_reset_tokens")
    .insert({
      user_id: opts.userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      source: opts.source,
      created_by_admin: opts.createdByAdmin || null,
    })
    .select("id, user_id, expires_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create password reset token");
  }

  return { token, tokenHash, expiresAt, record: data };
}

export async function getValidPasswordResetRecord(
  token: string
): Promise<PasswordResetRecord | null> {
  const tokenHash = hashResetToken(token);
  const { data, error } = await supabase
    .from("password_reset_tokens")
    .select("id, user_id, token_hash, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .single();

  if (error || !data) return null;
  if (data.used_at || isResetExpired(data.expires_at)) return null;

  return data as PasswordResetRecord;
}

export async function markResetTokenUsed(id: string) {
  const { data, error } = await supabase
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Reset link has already been used");
  }
}
