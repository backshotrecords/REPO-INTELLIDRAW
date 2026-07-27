import { describe, expect, it } from "vitest";

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const {
  createAgentCredential,
  hashAgentToken,
  tokenPrefixFromToken,
  validateAgentMermaid,
} = await import("./agent-access.js");

describe("agent credentials", () => {
  it("creates a parseable credential without storing the raw token as its hash", () => {
    const credential = createAgentCredential();

    expect(credential.token).toMatch(/^ida_[a-f0-9]{16}_[A-Za-z0-9_-]{40,}$/);
    expect(tokenPrefixFromToken(credential.token)).toBe(credential.tokenPrefix);
    expect(credential.tokenHash).toBe(hashAgentToken(credential.token));
    expect(credential.tokenHash).not.toContain(credential.token);
  });

  it("rejects malformed token prefixes", () => {
    expect(tokenPrefixFromToken("not-a-token")).toBeNull();
    expect(tokenPrefixFromToken("ida_short_secret")).toBeNull();
  });
});

describe("agent Mermaid validation", () => {
  it("accepts a basic flowchart", () => {
    expect(validateAgentMermaid("flowchart TD\n  A[Start] --> B[Done]")).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it("rejects unsupported diagram types and interactive callbacks", () => {
    const validation = validateAgentMermaid("sequenceDiagram\n  click A call run()");

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain("The diagram must start with a Mermaid flowchart or graph direction.");
    expect(validation.errors).toContain("Interactive links and callbacks are not allowed in agent-authored flowcharts.");
  });

  it("warns when diagram-level initialization is present", () => {
    const validation = validateAgentMermaid("%%{init: { 'theme': 'dark' }}%%\nflowchart LR\nA --> B");

    expect(validation.valid).toBe(true);
    expect(validation.warnings).toContain("Diagram-level Mermaid initialization is ignored by Intellidraw.");
  });
});
