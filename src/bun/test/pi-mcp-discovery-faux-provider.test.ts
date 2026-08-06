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
import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxToolCall, fauxText } from "@earendil-works/pi-ai/providers/faux";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { buildCommonTools } from "../engine/pi/tools/common.ts";
import { COMMON_TOOL_DEFINITIONS } from "../engine/common-tools.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import type { CommonToolContext } from "../engine/types.ts";
import { SDK_BUILTIN_TOOL_NAMES } from "../engine/pi/constants.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a minimal real AgentSession using a faux provider (no HTTP calls),
 * wired with the given customTools/toolNames instead of the "noop" tool used
 * by pi-session-tools-integration.test.ts's createTestSession.
 */
async function createDiscoveryTestSession(
  faux: FauxProviderRegistration,
  cwd: string,
  customTools: AgentTool<any>[],
  toolNames: string[],
) {
  const sessionManager = SessionManager.open(join(cwd, "session.jsonl"));
  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
  await resourceLoader.reload();

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: faux.getModel() as any,
    tools: [...SDK_BUILTIN_TOOL_NAMES, ...toolNames],
    customTools,
    sessionManager,
    resourceLoader,
    authStorage,
  });

  session.agent.state.thinkingLevel = "off";
  return session;
}

/**
 * Run one faux turn and wait for the agent loop to finish.
 * The faux provider must already have `setResponses` called before this.
 */
function runTurn(session: AgentSession, promptText: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("runTurn timed out"));
    }, 5000);
    let promptResolved = false;
    let agentEnded = false;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_end") {
        agentEnded = true;
        maybeResolve();
      }
    });

    const promptPromise = session.prompt(promptText);
    promptPromise
      .then(() => {
        promptResolved = true;
        maybeResolve();
      })
      .catch((err) => {
        clearTimeout(timeout);
        unsubscribe();
        reject(err);
      });

    function maybeResolve() {
      if (agentEnded && promptResolved) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    }
  });
}

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

    const session = await createDiscoveryTestSession(faux, cwd, tools, toolNames);

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
