import { describe, expect, it } from "vitest";

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const {
  AgentAccessError,
  createAgentCredential,
  hashAgentToken,
  publicAgentConnection,
  requireAgentWriteAccess,
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

describe("multi-folder agent connections", () => {
  const connection = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    root_project_id: "33333333-3333-4333-8333-333333333333",
    name: "Codex",
    token_prefix: "ida_1234567890abcdef",
    token_hash: "a".repeat(64),
    access_level: "edit" as const,
    include_subfolders: true,
    expires_at: "2099-01-01T00:00:00.000Z",
    revoked_at: null,
    last_used_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  it("publishes independently managed folder grants under one key", () => {
    const result = publicAgentConnection({
      ...connection,
      agent_connection_folders: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          connection_id: connection.id,
          project_id: "55555555-5555-4555-8555-555555555555",
          access_level: "read",
          include_subfolders: false,
          revoked_at: null,
          created_at: "2026-01-02T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          canvas_projects: { title: "Operations" },
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          connection_id: connection.id,
          project_id: "77777777-7777-4777-8777-777777777777",
          access_level: "edit",
          include_subfolders: true,
          revoked_at: "2026-02-01T00:00:00.000Z",
          created_at: "2026-01-03T00:00:00.000Z",
          updated_at: "2026-02-01T00:00:00.000Z",
          canvas_projects: { title: "Product" },
        },
      ],
    });

    expect(result.activeFolderCount).toBe(1);
    expect(result.rootProjectId).toBe("55555555-5555-4555-8555-555555555555");
    expect(result.folders).toEqual([
      expect.objectContaining({
        projectTitle: "Operations",
        accessLevel: "read",
        includeSubfolders: false,
        revokedAt: null,
      }),
      expect.objectContaining({
        projectTitle: "Product",
        accessLevel: "edit",
        includeSubfolders: true,
        revokedAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);
  });

  it("enforces write access at the folder-grant level", () => {
    expect(() => requireAgentWriteAccess({
      id: "44444444-4444-4444-8444-444444444444",
      connection_id: connection.id,
      project_id: "55555555-5555-4555-8555-555555555555",
      access_level: "edit",
      include_subfolders: true,
      revoked_at: null,
      created_at: connection.created_at,
      updated_at: connection.updated_at,
    })).not.toThrow();

    expect(() => requireAgentWriteAccess({
      id: "66666666-6666-4666-8666-666666666666",
      connection_id: connection.id,
      project_id: "77777777-7777-4777-8777-777777777777",
      access_level: "read",
      include_subfolders: false,
      revoked_at: null,
      created_at: connection.created_at,
      updated_at: connection.updated_at,
    })).toThrowError(AgentAccessError);
  });
});
