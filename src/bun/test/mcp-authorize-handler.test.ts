import { describe, it, expect, vi } from "vitest";
import { mcpHandlers, handleMcpOAuthCallback } from "../handlers/mcp.ts";
import type { McpRegistryPool } from "../mcp/registry-pool.ts";
import type { McpClientRegistry } from "../mcp/registry.ts";
import type { McpServerStatus } from "../mcp/types.ts";
import type { Database } from "bun:sqlite";

// ─── Fakes ──────────────────────────────────────────────────────────────────

function makeFakeRegistry(overrides: Partial<McpClientRegistry> = {}): McpClientRegistry {
  return {
    getStatus: vi.fn<() => McpServerStatus[]>().mockReturnValue([]),
    authorize: vi.fn().mockResolvedValue(undefined),
    completeAuthorization: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as McpClientRegistry;
}

function makeFakePool(registry: McpClientRegistry): McpRegistryPool {
  return {
    getGlobalRegistry: () => registry,
  } as unknown as McpRegistryPool;
}

// ─── mcp.authorize RPC handler ──────────────────────────────────────────────

describe("mcp.authorize handler", () => {
  it("9.6 calls registry.authorize(serverName) then returns registry.getStatus()", async () => {
    const status: McpServerStatus[] = [{ name: "my-server", state: "running", tools: [] }];
    const registry = makeFakeRegistry({
      getStatus: vi.fn().mockReturnValue(status),
    });
    const handlers = mcpHandlers({} as Database, {
      registryPool: makeFakePool(registry),
      resolveProject: () => null,
    });

    const result = await handlers["mcp.authorize"]({ serverName: "my-server" });

    expect(registry.authorize).toHaveBeenCalledWith("my-server");
    expect(registry.getStatus).toHaveBeenCalled();
    expect(result).toBe(status);
  });

  it("9.6 propagates a rejection from registry.authorize without calling getStatus first", async () => {
    const registry = makeFakeRegistry({
      authorize: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const handlers = mcpHandlers({} as Database, {
      registryPool: makeFakePool(registry),
      resolveProject: () => null,
    });

    await expect(handlers["mcp.authorize"]({ serverName: "my-server" })).rejects.toThrow("boom");
  });
});

// ─── GET /api/mcp/oauth/callback route ──────────────────────────────────────

describe("handleMcpOAuthCallback", () => {
  it("9.6 missing state param returns an error page without calling completeAuthorization", async () => {
    const registry = makeFakeRegistry();
    const pool = makeFakePool(registry);
    const url = new URL("http://localhost/api/mcp/oauth/callback?code=abc");

    const resp = await handleMcpOAuthCallback(url, pool);

    expect(resp.status).toBe(200);
    const body = await resp.text();
    expect(body).toMatch(/Missing state parameter/);
    expect(registry.completeAuthorization).not.toHaveBeenCalled();
  });

  it("9.6 error query param (user denied) returns a denial page without calling completeAuthorization", async () => {
    const registry = makeFakeRegistry();
    const pool = makeFakePool(registry);
    const url = new URL("http://localhost/api/mcp/oauth/callback?state=xyz&error=access_denied");

    const resp = await handleMcpOAuthCallback(url, pool);

    const body = await resp.text();
    expect(body).toMatch(/not granted/i);
    expect(body).toMatch(/access_denied/);
    expect(registry.completeAuthorization).not.toHaveBeenCalled();
  });

  it("9.6 missing code param returns an error page without calling completeAuthorization", async () => {
    const registry = makeFakeRegistry();
    const pool = makeFakePool(registry);
    const url = new URL("http://localhost/api/mcp/oauth/callback?state=xyz");

    const resp = await handleMcpOAuthCallback(url, pool);

    const body = await resp.text();
    expect(body).toMatch(/Missing authorization code/);
    expect(registry.completeAuthorization).not.toHaveBeenCalled();
  });

  it("9.6 valid state+code calls completeAuthorization(state, code) and returns a success page", async () => {
    const registry = makeFakeRegistry();
    const pool = makeFakePool(registry);
    const url = new URL("http://localhost/api/mcp/oauth/callback?state=xyz&code=abc");

    const resp = await handleMcpOAuthCallback(url, pool);

    expect(registry.completeAuthorization).toHaveBeenCalledWith("xyz", "abc");
    const body = await resp.text();
    expect(body).toMatch(/Authorization complete/);
  });

  it("9.6 completeAuthorization rejection is surfaced as a failure page, not an unhandled error", async () => {
    const registry = makeFakeRegistry({
      completeAuthorization: vi.fn().mockRejectedValue(new Error("Unknown or expired OAuth authorization state")),
    });
    const pool = makeFakePool(registry);
    const url = new URL("http://localhost/api/mcp/oauth/callback?state=stale&code=abc");

    const resp = await handleMcpOAuthCallback(url, pool);

    expect(resp.status).toBe(200);
    const body = await resp.text();
    expect(body).toMatch(/Authorization failed/);
    expect(body).toMatch(/Unknown or expired OAuth authorization state/);
  });
});
