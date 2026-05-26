import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildResetUrl,
  generateResetToken,
  getResetTokenTtlMinutes,
  hashResetToken,
  isResetExpired,
} from "./passwordReset";
import type { VercelRequest } from "@vercel/node";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("password reset helpers", () => {
  it("generates URL-safe reset tokens", () => {
    const token = generateResetToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThan(32);
  });

  it("hashes tokens deterministically without returning the raw token", () => {
    const token = "sample-token";
    const hash = hashResetToken(token);

    expect(hash).toBe(hashResetToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
  });

  it("caps configured token TTL at one day", () => {
    vi.stubEnv("PASSWORD_RESET_TOKEN_TTL_MINUTES", "99999");

    expect(getResetTokenTtlMinutes()).toBe(1440);
  });

  it("detects expired timestamps", () => {
    expect(isResetExpired("2026-05-26T10:00:00.000Z", new Date("2026-05-26T10:01:00.000Z"))).toBe(true);
    expect(isResetExpired("2026-05-26T10:02:00.000Z", new Date("2026-05-26T10:01:00.000Z"))).toBe(false);
  });

  it("builds reset URLs from the configured public app URL", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://intellidraw.example.com/");

    const url = buildResetUrl({ headers: {} } as VercelRequest, "abc123");

    expect(url).toBe("https://intellidraw.example.com/reset-password?token=abc123");
  });
});
