/**
 * Pi engine — MCP discovery tools presence (scenario: "Pi engine exposes discovery tools",
 * mcp-tool-discovery/spec.md). Pi previously had no MCP access at all; this confirms
 * list_mcp_servers/list_mcp_tools/invoke_mcp_tool now surface through buildCommonTools()
 * (COMMON_TOOL_DEFINITIONS) exactly like every other common tool, and that a registry
 * placed on ctx.runtime.mcpRegistry is reachable by the wrapped executor.
 *
 * Mirrors the DI style of pi-common-tools-bridge.test.ts: builds a CommonToolContext by
 * hand (no DB) and exercises buildCommonTools with the real COMMON_TOOL_DEFINITIONS/executeCommonTool.
 */

import { describe, expect, it } from "vitest";
import { buildCommonTools } from "../engine/pi/tools/common.ts";
import { COMMON_TOOL_DEFINITIONS } from "../engine/common-tools.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import type { CommonToolContext } from "../engine/types.ts";

function makeCtx(overrides: Partial<CommonToolContext["runtime"]> = {}): CommonToolContext {
  return {
    task: { id: null, boardId: null, conversationId: 1 },
    workspaceKey: "test-workspace",
    repos: {} as CommonToolContext["repos"],
    workflow: {
      onTransition: () => {},
      onHumanTurn: () => {},
      onCancel: () => {},
      onTaskUpdated: () => {},
    },
    runtime: overrides,
  };
}

describe("Pi engine MCP discovery tools", () => {
  it("includes list_mcp_servers, list_mcp_tools, and invoke_mcp_tool among the built tools", () => {
    const ctx = makeCtx();
    const tools = buildCommonTools(ctx, undefined, undefined, COMMON_TOOL_DEFINITIONS);
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_mcp_servers");
    expect(names).toContain("list_mcp_tools");
    expect(names).toContain("invoke_mcp_tool");
  });

  it("list_mcp_servers reaches the registry placed on ctx.runtime.mcpRegistry", async () => {
    const registry = new McpClientRegistry(
      { servers: [{ name: "alpha", transport: { type: "stdio", command: "alpha-cmd" } }] },
      { clientFactory: () => new FakeMcpClient() },
    );
    await registry.startAll();

    const ctx = makeCtx({ mcpRegistry: registry, mcpEnabledTools: [] });
    const tools = buildCommonTools(ctx, undefined, undefined, COMMON_TOOL_DEFINITIONS);
    const listServersTool = tools.find((t) => t.name === "list_mcp_servers")!;

    const result = await listServersTool.execute("call-1", {}, new AbortController().signal);
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toContain("alpha");
    expect(text).toContain("running");
  });

  it("returns a clear error (not a throw) when no registry is configured", async () => {
    const ctx = makeCtx();
    const tools = buildCommonTools(ctx, undefined, undefined, COMMON_TOOL_DEFINITIONS);
    const listServersTool = tools.find((t) => t.name === "list_mcp_servers")!;

    const result = await listServersTool.execute("call-1", {}, new AbortController().signal);
    const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text;
    expect(text).toMatch(/no mcp servers are configured/i);
  });
});
