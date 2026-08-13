/**
 * Integration test (task 11.6, dynamic-mcp-discovery): proves the MCP discovery
 * tools (list_mcp_servers/list_mcp_tools/invoke_mcp_tool) are reachable through a
 * genuine Pi SDK tool-call loop — not just via direct `tool.execute(...)` calls
 * (see pi-mcp-discovery-tools.test.ts for that unit-style coverage).
 *
 * This is a sibling of pi-session-tools-integration.test.ts: it drives the real
 * @earendil-works/pi-coding-agent SDK with registerFauxProvider() (scripted LLM,
 * no HTTP calls). The faux model "calls" each discovery tool via fauxToolCall(),
 * and the real SDK agent loop looks up and executes the AgentTool by name exactly
 * as production code does — dispatching into buildCommonTools()'s wrapped
 * executeCommonTool(), which in turn reaches a FakeMcpClient-backed McpClientRegistry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { buildCommonTools } from "../engine/pi/tools/common.ts";
import { COMMON_TOOL_DEFINITIONS } from "../engine/common-tools.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import type { CommonToolContext } from "../engine/types.ts";
import { createFauxAgentSession, runTurn } from "./support/pi-faux-session.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────



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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let faux: FauxProviderRegistration;
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "pi-mcp-discovery-"));
  faux = registerFauxProvider();
});

afterEach(() => {
  faux.unregister();
  rmSync(cwd, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pi engine — MCP discovery tools via real SDK tool-call loop (faux provider)", () => {
  it("dispatches list_mcp_servers, list_mcp_tools, and invoke_mcp_tool through the real Pi agent loop to a FakeMcpClient-backed registry", async () => {
    const fakeClient = new FakeMcpClient({
      tools: [{ name: "echo", description: "echoes input", inputSchema: { type: "object" } }],
      callToolResult: "echoed!",
    });
    const registry = new McpClientRegistry(
      { servers: [{ name: "alpha", transport: { type: "stdio", command: "alpha-cmd" } }] },
      { clientFactory: () => fakeClient },
    );
    await registry.startAll();

    const ctx = makeCtx({ mcpRegistry: registry, mcpEnabledTools: ["alpha:echo"] });
    const tools = buildCommonTools(ctx, undefined, undefined, COMMON_TOOL_DEFINITIONS);
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("list_mcp_servers");
    expect(toolNames).toContain("list_mcp_tools");
    expect(toolNames).toContain("invoke_mcp_tool");

    const session = await createFauxAgentSession({ faux, cwd, tools });

    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("list_mcp_servers", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("list_mcp_tools", { server: "alpha" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("invoke_mcp_tool", { server: "alpha", tool: "echo", arguments: {} }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxText("Done")),
    ]);

    await runTurn(session, "Use the MCP discovery tools to call alpha's echo tool.");

    // The real SDK agent loop actually invoked the registered AgentTool for
    // invoke_mcp_tool, which reached the registry and its FakeMcpClient.
    expect(fakeClient.calls).toHaveLength(1);
    expect(fakeClient.calls[0]).toEqual({ name: "echo", args: {} });
  });
});
