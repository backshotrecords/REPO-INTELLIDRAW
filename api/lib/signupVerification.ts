import crypto from "crypto";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import type { VercelRequest } from "@vercel/node";
import { supabase } from "./db.js";
import { getAppBaseUrl } from "./passwordReset.js";

const SIGNUP_TOKEN_TTL_MINUTES = 5;
const SIGNUP_MAX_FAILED_ATTEMPTS = 5;
const SIGNUP_PAYLOAD_PURPOSE = "signup_verification";
const SIGNUP_PAYLOAD_SECRET =
  process.env.SIGNUP_VERIFICATION_SECRET ||
  process.env.ENCRYPTION_KEY ||
  "intellidraw-signup-verification-secret-change-in-prod";

export interface SignupVerificationRecord {
  id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  failed_attempts: number;
}

export interface SignupVerificationPayload {
  purpose: typeof SIGNUP_PAYLOAD_PURPOSE;
  email: string;
  displayName: string;
  passwordHash: string;
  tokenHash: string;
  expiresAt: string;
  issuedAt: string;
}

export function getSignupTokenTtlMinutes(): number {
  return SIGNUP_TOKEN_TTL_MINUTES;
}

export function getSignupMaxFailedAttempts(): number {
  return SIGNUP_MAX_FAILED_ATTEMPTS;
}

export function generateSignupToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSignupToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getSignupExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SIGNUP_TOKEN_TTL_MINUTES * 60 * 1000);
}

export function isSignupTokenExpired(expiresAt: string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function buildSignupVerificationUrl(
  req: VercelRequest,
  token: string,
  payload: string
): string {
  const url = new URL("/verify-signup", getAppBaseUrl(req));
  url.searchParams.set("token", token);
  url.searchParams.set("payload", payload);
  return url.toString();
}

export function createSignupPayload(opts: {
  email: string;
  displayName: string;
  passwordHash: string;
  tokenHash: string;
  expiresAt: string;
}): SignupVerificationPayload {
  return {
    purpose: SIGNUP_PAYLOAD_PURPOSE,
    email: opts.email,
    displayName: opts.displayName,
    passwordHash: opts.passwordHash,
    tokenHash: opts.tokenHash,
    expiresAt: opts.expiresAt,
    issuedAt: new Date().toISOString(),
  };
}

export function sealSignupPayload(payload: SignupVerificationPayload): string {
  const key = getSignupPayloadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function openSignupPayload(sealed: string): SignupVerificationPayload {
  const [ivValue, authTagValue, ciphertextValue] = sealed.split(".");
  if (!ivValue || !authTagValue || !ciphertextValue) {
    throw new Error("Invalid signup payload");
  }

  const key = getSignupPayloadKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(decrypted) as Partial<SignupVerificationPayload>;

  if (
    parsed.purpose !== SIGNUP_PAYLOAD_PURPOSE ||
    typeof parsed.email !== "string" ||
    typeof parsed.displayName !== "string" ||
    typeof parsed.passwordHash !== "string" ||
    typeof parsed.tokenHash !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    typeof parsed.issuedAt !== "string"
  ) {
    throw new Error("Invalid signup payload");
  }

  return parsed as SignupVerificationPayload;
}

export async function createSignupVerificationRecord(opts: {
  tokenHash: string;
  expiresAt: string;
}) {
  const { data, error } = await supabase
    .from("signup_verification_tokens")
    .insert({
      token_hash: opts.tokenHash,
      expires_at: opts.expiresAt,
    })
    .select("id, token_hash, expires_at, used_at, failed_attempts")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create signup verification token");
  }

  return data as SignupVerificationRecord;
}

export async function getSignupVerificationRecord(
  tokenHash: string
): Promise<SignupVerificationRecord | null> {
  const { data, error } = await supabase
    .from("signup_verification_tokens")
    .select("id, token_hash, expires_at, used_at, failed_attempts")
    .eq("token_hash", tokenHash)
    .single();

  if (error || !data) return null;
  return data as SignupVerificationRecord;
}

export async function incrementSignupFailedAttempts(id: string) {
  const { data: record } = await supabase
    .from("signup_verification_tokens")
    .select("failed_attempts")
    .eq("id", id)
    .single();

  const failedAttempts = Number(record?.failed_attempts || 0) + 1;
  await supabase
    .from("signup_verification_tokens")
    .update({ failed_attempts: failedAttempts })
    .eq("id", id)
    .is("used_at", null);

  return failedAttempts;
}

export async function markSignupTokenUsed(id: string) {
  const { data, error } = await supabase
    .from("signup_verification_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id)
    .is("used_at", null)
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Verification link has already been used");
  }
}

function getSignupPayloadKey(): Buffer {
  return scryptSync(SIGNUP_PAYLOAD_SECRET, "intellidraw-signup-payload", 32);
}
