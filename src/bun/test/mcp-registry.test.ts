/**
 * Baseline McpClientRegistry coverage: listTools/callTool/getStatus/getServerConfig
 * behavior outside the OAuth state machine (already covered separately in
 * mcp-registry-oauth.test.ts). This gap existed before the dynamic-mcp-discovery
 * change; it's filled now because the new discovery-tools executor
 * (src/bun/mcp/discovery-tools.ts) depends directly on this surface.
 *
 * Uses the same injected-FakeMcpClient DI seam (clientFactory) as the OAuth suite —
 * no real subprocess or network transport involved.
 */

import { describe, it, expect } from "vitest";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import type { McpServerConfig } from "../mcp/types.ts";

function stdioServer(name: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name, transport: { type: "stdio", command: `${name}-cmd` }, ...overrides };
}

describe("McpClientRegistry (baseline, non-OAuth)", () => {
  describe("listTools", () => {
    it("returns tools from all running servers when no filter is given", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("alpha"), stdioServer("beta")] },
        {
          clientFactory: (config) =>
            new FakeMcpClient({
              tools: [{ name: `${config.name}-tool`, description: "d", inputSchema: { type: "object" } }],
            }),
        },
      );
      await registry.startAll();

      const tools = registry.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["alpha-tool", "beta-tool"]);
      expect(tools.every((t) => t.qualifiedName.startsWith("mcp__"))).toBe(true);
    });

    it("filters by server:tool pairs when a filter array is given", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("alpha")] },
        {
          clientFactory: (config) =>
            new FakeMcpClient({
              tools: [
                { name: "read", description: "reads", inputSchema: { type: "object" } },
                { name: "write", description: "writes", inputSchema: { type: "object" } },
              ],
            }),
        },
      );
      await registry.startAll();

      expect(registry.listTools(["alpha:read"]).map((t) => t.name)).toEqual(["read"]);
    });

    it("returns an empty array when the filter is an empty array (nothing visible)", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("alpha")] },
        {
          clientFactory: () => new FakeMcpClient({ tools: [{ name: "read", inputSchema: { type: "object" } }] }),
        },
      );
      await registry.startAll();

      expect(registry.listTools([])).toEqual([]);
    });

    it("excludes tools from servers that are not running", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("broken")] },
        {
          clientFactory: () => new FakeMcpClient({ initializeError: new Error("boom") }),
        },
      );
      await registry.startAll();

      expect(registry.listTools()).toEqual([]);
    });
  });

  describe("callTool", () => {
    it("invokes the underlying client and returns its text result", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("alpha")] },
        { clientFactory: () => new FakeMcpClient({ callToolResult: "42" }) },
      );
      await registry.startAll();

      await expect(registry.callTool("alpha", "answer", { q: "life" })).resolves.toBe("42");
    });

    it("throws for an unknown server name", async () => {
      const registry = new McpClientRegistry({ servers: [] });
      await expect(registry.callTool("ghost", "tool", {})).rejects.toThrow(/not found/);
    });

    it("throws for a server that is not running", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("idle-one")] },
        { clientFactory: () => new FakeMcpClient() },
      );
      // Deliberately not calling startAll() — server stays "idle".
      await expect(registry.callTool("idle-one", "tool", {})).rejects.toThrow(/not running/);
    });

    it("propagates errors thrown by the underlying client", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("alpha")] },
        { clientFactory: () => new FakeMcpClient({ callToolError: new Error("tool exploded") }) },
      );
      await registry.startAll();

      await expect(registry.callTool("alpha", "boom", {})).rejects.toThrow("tool exploded");
    });
  });

  describe("getStatus / getServerConfig", () => {
    it("reflects disabled servers without starting them", async () => {
      const registry = new McpClientRegistry({ servers: [stdioServer("off", { enabled: false })] });
      await registry.startAll();

      const status = registry.getStatus().find((s) => s.name === "off");
      expect(status?.state).toBe("disabled");
    });

    it("reflects error state and message when initialize fails", async () => {
      const registry = new McpClientRegistry(
        { servers: [stdioServer("broken")] },
        { clientFactory: () => new FakeMcpClient({ initializeError: new Error("connection refused") }) },
      );
      await registry.startAll();

      const status = registry.getStatus().find((s) => s.name === "broken");
      expect(status?.state).toBe("error");
      expect(status?.error).toBe("connection refused");
    });

    it("returns the original server config by name", () => {
      const registry = new McpClientRegistry({ servers: [stdioServer("alpha", { description: "Alpha server" })] });
      expect(registry.getServerConfig("alpha")?.description).toBe("Alpha server");
      expect(registry.getServerConfig("missing")).toBeUndefined();
    });
  });

  describe("shutdown / reload", () => {
    it("closes clients and returns servers to idle on shutdown", async () => {
      const client = new FakeMcpClient();
      const registry = new McpClientRegistry({ servers: [stdioServer("alpha")] }, { clientFactory: () => client });
      await registry.startAll();

      await registry.shutdown();

      expect(client.closed).toBe(true);
      expect(registry.getStatus().find((s) => s.name === "alpha")?.state).toBe("idle");
    });

    it("reload() of a single server stops and restarts only that server", async () => {
      let alphaStarts = 0;
      const registry = new McpClientRegistry(
        { servers: [stdioServer("alpha"), stdioServer("beta")] },
        {
          clientFactory: (config) => {
            if (config.name === "alpha") alphaStarts++;
            return new FakeMcpClient();
          },
        },
      );
      await registry.startAll();
      expect(alphaStarts).toBe(1);

      await registry.reload("alpha");

      expect(alphaStarts).toBe(2);
      expect(registry.getStatus().find((s) => s.name === "beta")?.state).toBe("running");
    });
  });
});
