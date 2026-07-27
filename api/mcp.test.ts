import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describe, expect, it } from "vitest";

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key";

const { default: handler } = await import("./mcp.js");

function createResponse() {
  const state: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string | number | readonly string[]>;
  } = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };

  const response = {
    headersSent: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      state.headers[name.toLowerCase()] = value;
      return response;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  } as unknown as VercelResponse;

  return { response, state };
}

describe("MCP HTTP transport methods", () => {
  it.each(["GET", "POST"])("passes %s requests through to authentication", async (method) => {
    const { response, state } = createResponse();
    const request = {
      method,
      headers: {},
      body: method === "POST" ? {} : undefined,
    } as unknown as VercelRequest;

    await handler(request, response);

    expect(state.statusCode).toBe(401);
    expect(state.headers["www-authenticate"]).toBe('Bearer realm="Intellidraw MCP"');
    expect(state.headers.allow).toBeUndefined();
  });

  it("rejects unsupported methods and advertises both MCP transport methods", async () => {
    const { response, state } = createResponse();
    const request = { method: "PUT", headers: {} } as unknown as VercelRequest;

    await handler(request, response);

    expect(state.statusCode).toBe(405);
    expect(state.headers.allow).toBe("GET, POST");
    expect(state.body).toEqual({ error: "Method not allowed" });
  });
});
