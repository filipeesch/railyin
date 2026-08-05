/**
 * Unit tests for the pure MCP discovery/invocation executor functions backing
 * list_mcp_servers/list_mcp_tools/invoke_mcp_tool (see openspec/changes/dynamic-mcp-discovery,
 * specs/mcp-tool-discovery/spec.md for the scenario source of truth).
 *
 * Uses a real McpClientRegistry with the injected FakeMcpClient DI seam — these functions
 * take a registry directly, so no engine/orchestrator wiring is needed to exercise them.
 */

import { describe, it, expect } from "vitest";
import { McpClientRegistry } from "../mcp/registry.ts";
import { execListMcpServers, execListMcpTools, execInvokeMcpTool } from "../mcp/discovery-tools.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import type { McpServerConfig } from "../mcp/types.ts";

function stdioServer(name: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name, transport: { type: "stdio", command: `${name}-cmd` }, ...overrides };
}

describe("execListMcpServers", () => {
  it("returns a message when no servers are configured", () => {
    const registry = new McpClientRegistry({ servers: [] });
    expect(execListMcpServers(registry)).toMatch(/no mcp servers/i);
  });

  it("lists all configured servers regardless of enabled_mcp_tools visibility", async () => {
    const registry = new McpClientRegistry(
      { servers: [stdioServer("alpha", { description: "Alpha things" })] },
      { clientFactory: () => new FakeMcpClient() },
    );
    await registry.startAll();

    const result = execListMcpServers(registry);
    expect(result).toContain("alpha");
    expect(result).toContain("Alpha things");
    expect(result).toContain("running");
  });

  it("includes non-running servers with their state and error", async () => {
    const registry = new McpClientRegistry(
      { servers: [stdioServer("broken")] },
      { clientFactory: () => new FakeMcpClient({ initializeError: new Error("connection refused") }) },
    );
    await registry.startAll();

    const result = execListMcpServers(registry);
    expect(result).toContain("broken");
    expect(result).toContain("error");
    expect(result).toContain("connection refused");
  });

  it("includes servers disabled via config with state disabled", async () => {
    const registry = new McpClientRegistry({ servers: [stdioServer("off", { enabled: false })] });
    await registry.startAll();

    expect(execListMcpServers(registry)).toContain("disabled");
  });
});

describe("execListMcpTools", () => {
  async function buildRunningRegistry() {
    const registry = new McpClientRegistry(
      { servers: [stdioServer("alpha")] },
      {
        clientFactory: () =>
          new FakeMcpClient({
            tools: [
              { name: "read_file", description: "Reads a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
              { name: "write_file", description: "Writes a file", inputSchema: { type: "object" } },
            ],
          }),
      },
    );
    await registry.startAll();
    return registry;
  }

  it("lists only tools present in the enabled_mcp_tools filter", async () => {
    const registry = await buildRunningRegistry();
    const result = execListMcpTools(registry, ["alpha:read_file"], "alpha");
    expect(result).toContain("read_file");
    expect(result).not.toContain("write_file");
  });

  it("returns an empty-visibility message when enabled_mcp_tools is []", async () => {
    const registry = await buildRunningRegistry();
    const result = execListMcpTools(registry, [], "alpha");
    expect(result).toMatch(/no tools are visible/i);
  });

  it("treats a missing (undefined/null) filter the same as an empty one — deny by default", async () => {
    const registry = await buildRunningRegistry();
    expect(execListMcpTools(registry, undefined, "alpha")).toMatch(/no tools are visible/i);
    expect(execListMcpTools(registry, null, "alpha")).toMatch(/no tools are visible/i);
  });

  it("returns an error for a server that is not running", async () => {
    const registry = new McpClientRegistry(
      { servers: [stdioServer("idle-one")] },
      { clientFactory: () => new FakeMcpClient() },
    );
    // Not started — server stays "idle".
    const result = execListMcpTools(registry, ["idle-one:whatever"], "idle-one");
    expect(result).toMatch(/error/i);
    expect(result).toMatch(/idle/i);
  });

  it("returns an error for an unknown server name", async () => {
    const registry = new McpClientRegistry({ servers: [] });
    const result = execListMcpTools(registry, [], "ghost");
    expect(result).toMatch(/not found/i);
  });
});

describe("execInvokeMcpTool", () => {
  async function buildRunningRegistry(opts: { callToolError?: Error; callToolResult?: string } = {}) {
    const registry = new McpClientRegistry(
      { servers: [stdioServer("alpha")] },
      { clientFactory: () => new FakeMcpClient({ ...opts, tools: [{ name: "read_file", inputSchema: { type: "object" } }] }) },
    );
    await registry.startAll();
    return registry;
  }

  it("invokes the registry and returns the tool result when enabled", async () => {
    const registry = await buildRunningRegistry({ callToolResult: "file contents" });
    const result = await execInvokeMcpTool(registry, ["alpha:read_file"], "alpha", "read_file", { path: "/tmp/x" });
    expect(result).toBe("file contents");
  });

  it("rejects invocation of a tool not present in enabled_mcp_tools without calling the registry", async () => {
    const registry = await buildRunningRegistry();
    const result = await execInvokeMcpTool(registry, [], "alpha", "read_file", {});
    expect(result).toMatch(/not enabled/i);
  });

  it("rejects invocation for a non-running server", async () => {
    const registry = new McpClientRegistry(
      { servers: [stdioServer("idle-one")] },
      { clientFactory: () => new FakeMcpClient() },
    );
    const result = await execInvokeMcpTool(registry, ["idle-one:tool"], "idle-one", "tool", {});
    expect(result).toMatch(/not available/i);
  });

  it("surfaces an underlying callTool error as text instead of throwing", async () => {
    const registry = await buildRunningRegistry({ callToolError: new Error("upstream failure") });
    const result = await execInvokeMcpTool(registry, ["alpha:read_file"], "alpha", "read_file", {});
    expect(result).toMatch(/upstream failure/);
  });

  it("returns an error for an unknown server name", async () => {
    const registry = new McpClientRegistry({ servers: [] });
    const result = await execInvokeMcpTool(registry, ["ghost:tool"], "ghost", "tool", {});
    expect(result).toMatch(/not found/i);
  });
});
