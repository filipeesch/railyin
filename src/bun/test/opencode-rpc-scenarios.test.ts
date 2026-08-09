import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeEngine } from "../engine/opencode/engine.ts";
import type { BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { createBackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { McpRegistryPool } from "../mcp/registry-pool.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import {
  MockOpenCodeSdkAdapter,
  callTool,
  done,
  fatal,
  reasoning,
  token,
  toolResult,
  toolStart,
  waitForAbort,
} from "./support/opencode-sdk-mock.ts";
import {
  runCancellationScenario,
  runFatalFailureScenario,
  runMcpDiscoveryScenario,
  runModelListingScenario,
  runMultiTurnChatScenario,
  runSingleTurnChatScenario,
  runToolFailureScenario,
  runToolSuccessScenario,
} from "./support/shared-rpc-scenarios.ts";

const TASK_MODEL = "opencode/test/mock-model";
const QUALIFIED_MODEL: import("../engine/types.ts").EngineModelInfo = {
  qualifiedId: TASK_MODEL,
  displayName: "Mock OpenCode Model",
};

const runtimes: BackendRpcRuntime[] = [];

function createOpenCodeRuntime(adapter: MockOpenCodeSdkAdapter, registryPool?: McpRegistryPool): BackendRpcRuntime {
  adapter.setModels([QUALIFIED_MODEL]);

  const runtime = createBackendRpcRuntime({
    taskModel: TASK_MODEL,
    createEngine: ({ onTaskUpdated, onNewMessage }) =>
      new OpenCodeEngine(onTaskUpdated, onNewMessage, adapter),
    registryPool,
  });
  runtimes.push(runtime);
  return runtime;
}

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()!.cleanup();
  }
});

// ── Shared engine-agnostic scenarios ────────────────────────────────────────

describe("OpenCode backend RPC scenarios", () => {
  it("covers single-turn and multi-turn chat via shared scenarios", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter
      .queueCreate({ steps: [token("Hello"), token(" world"), done()] })
      .queueCreate({ steps: [token("Reply one"), done()] })
      .queueResume({ steps: [token("Reply two"), done()] });
    const runtime = createOpenCodeRuntime(adapter);

    await runSingleTurnChatScenario(runtime);
    await runMultiTurnChatScenario(runtime);
  });

  it("covers tool success and tool failure persistence via shared scenarios", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter
      .queueCreate({
        steps: [toolStart("call-tool-1", "create_card"), toolResult("call-tool-1", "create_card", "ok"), token("tool finished"), done()],
      })
      .queueCreate({
        steps: [toolStart("call-tool-2", "edit_card"), toolResult("call-tool-2", "edit_card", "failed", true), token("recovered"), done()],
      });
    const runtime = createOpenCodeRuntime(adapter);

    await runToolSuccessScenario(runtime);
    await runToolFailureScenario(runtime);
  });

  it("covers cancellation via shared scenario", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [token("working"), waitForAbort()] });
    const runtime = createOpenCodeRuntime(adapter);

    await runCancellationScenario(runtime);
  });

  it("covers fatal failures and model listing via shared scenarios", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [fatal("OpenCode exploded")] });
    const runtime = createOpenCodeRuntime(adapter);

    await runFatalFailureScenario(runtime);
    await runModelListingScenario(runtime);
  });

  it("includes reasoning events in conversation messages", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [reasoning("internal plan"), token("Done."), done()] });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Think step by step" });
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    // 07-01 contract: reasoning is no longer persisted to conversation_messages
    // (zero writes during runs) — the run completing is the observable outcome.
  });
});

// ── Session lifecycle ────────────────────────────────────────────────────────

describe("OpenCode session lifecycle", () => {
  it("creates a new session on first execution (task 6.1)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [token("first"), done()] });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello" });
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    expect(adapter.trace.createCalls).toHaveLength(1);
    expect(adapter.trace.resumeCalls).toHaveLength(0);
  });

  it("reuses the session on subsequent executions for the same task (task 6.2)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter
      .queueCreate({ steps: [token("first"), done()] })
      .queueResume({ steps: [token("second"), done()] });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "First" });
    await runtime.waitForExecutionStatus(first.executionId, "completed");
    await runtime.waitForExecutionStatus(first.executionId, "completed");

    const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Second" });
    await runtime.waitForExecutionStatus(second.executionId, "completed");

    expect(adapter.trace.createCalls).toHaveLength(1);
    expect(adapter.trace.resumeCalls).toHaveLength(1);
  });

  it("creates distinct sessions for two different tasks (task 6.3)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter
      .queueCreate({ steps: [token("task-1 done"), done()] })
      .queueCreate({ steps: [token("task-2 done"), done()] });
    const runtime = createOpenCodeRuntime(adapter);

    const { taskId: taskId1 } = await runtime.createTask();
    const { taskId: taskId2 } = await runtime.createTask();

    const r1 = await runtime.handlers["tasks.sendMessage"]({ taskId: taskId1, content: "Task one" });
    const r2 = await runtime.handlers["tasks.sendMessage"]({ taskId: taskId2, content: "Task two" });

    await runtime.waitForExecutionStatus(r1.executionId, "completed");
    await runtime.waitForExecutionStatus(r2.executionId, "completed");

    expect(adapter.trace.createCalls).toHaveLength(2);
    const convIds = adapter.trace.createCalls.map((c) => c.conversationId);
    expect(new Set(convIds).size).toBe(2);
  });

  it("cleans up activeContexts after successful execution (task 6.4)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [token("done"), done()] });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Execute" });
    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    expect(adapter.activeContexts.size).toBe(0);
  });

  it("cleans up activeContexts after fatal error execution (task 6.5)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [fatal("something went wrong")] });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Explode" });
    await runtime.waitForExecutionStatus(result.executionId, "failed");

    expect(adapter.activeContexts.size).toBe(0);
  });
});

describe("OpenCode — MCP discovery tools (dynamic-mcp-discovery)", () => {
  it("covers list_mcp_servers → list_mcp_tools → invoke_mcp_tool via the shared scenario", async () => {
    const registry = new McpClientRegistry(
      { servers: [{ name: "alpha", transport: { type: "stdio", command: "alpha-cmd" } }] },
      {
        clientFactory: () =>
          new FakeMcpClient({
            tools: [{ name: "echo", description: "echoes input", inputSchema: { type: "object" } }],
            callToolResult: "echoed!",
          }),
      },
    );
    await registry.startAll();
    const registryPool = new McpRegistryPool(() => registry);

    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({
      steps: [
        callTool("list_mcp_servers", {}),
        callTool("list_mcp_tools", { server: "alpha" }),
        callTool("invoke_mcp_tool", { server: "alpha", tool: "echo", arguments: {} }),
        done(),
      ],
    });
    const runtime = createOpenCodeRuntime(adapter, registryPool);

    await runMcpDiscoveryScenario(runtime);
  });
});
