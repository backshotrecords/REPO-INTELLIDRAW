import { afterEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest } from "@vercel/node";
import {
  buildSignupVerificationUrl,
  createSignupPayload,
  generateSignupToken,
  getSignupExpiry,
  getSignupTokenTtlMinutes,
  hashSignupToken,
  isSignupTokenExpired,
  openSignupPayload,
  sealSignupPayload,
} from "./signupVerification";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signup verification helpers", () => {
  it("uses short URL-safe tokens", () => {
    const token = generateSignupToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(32);
  });

  it("hashes tokens without returning the raw token", () => {
    const token = "sample-token";
    const hash = hashSignupToken(token);

    expect(hash).toBe(hashSignupToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
  });

  it("expires signup links after five minutes", () => {
    const issuedAt = new Date("2026-06-29T10:00:00.000Z");
    const expiresAt = getSignupExpiry(issuedAt).toISOString();

    expect(getSignupTokenTtlMinutes()).toBe(5);
    expect(expiresAt).toBe("2026-06-29T10:05:00.000Z");
    expect(isSignupTokenExpired(expiresAt, new Date("2026-06-29T10:05:01.000Z"))).toBe(true);
    expect(isSignupTokenExpired(expiresAt, new Date("2026-06-29T10:04:59.000Z"))).toBe(false);
  });

  it("seals signup payloads as URL-safe encrypted blobs", () => {
    vi.stubEnv("SIGNUP_VERIFICATION_SECRET", "test-secret");

    const payload = createSignupPayload({
      email: "person@example.com",
      displayName: "Person Example",
      passwordHash: "$2a$12$example",
      tokenHash: hashSignupToken("token"),
      expiresAt: "2026-06-29T10:05:00.000Z",
    });
    const sealed = sealSignupPayload(payload);

    expect(sealed).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(sealed).not.toContain(payload.email);
    expect(openSignupPayload(sealed)).toEqual(payload);
  });

  it("builds verification URLs from request origin", () => {
    const url = buildSignupVerificationUrl({
      headers: { origin: "https://preview.intellidraw.app" },
    } as VercelRequest, "abc123", "payload456");

    expect(url).toBe("https://preview.intellidraw.app/verify-signup?token=abc123&payload=payload456");
  });
});
