import { afterEach, describe, expect, it } from "vitest";
import { ClaudeEngine } from "../engine/claude/engine.ts";
import type { BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { createBackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { McpRegistryPool } from "../mcp/registry-pool.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import {
  MockClaudeSdkAdapter,
  callTool,
  done,
  fatal,
  reasoning,
  subagentStart,
  subagentStop,
  token,
  toolResult,
  toolStart,
  waitForAbort,
} from "./support/claude-sdk-mock.ts";
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

const runtimes: BackendRpcRuntime[] = [];

function createClaudeRuntime(adapter: MockClaudeSdkAdapter, registryPool?: McpRegistryPool): BackendRpcRuntime {
  adapter.setModels([
    {
      value: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      supportsEffort: true,
      supportsAdaptiveThinking: true,
    },
  ]);

  const runtime = createBackendRpcRuntime({
    taskModel: "claude/claude-sonnet-4-6",
    createEngine: ({ onTaskUpdated }) =>
      new ClaudeEngine("claude-sonnet-4-6", onTaskUpdated, adapter),
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

describe("Claude backend RPC scenarios", () => {
  it("covers single-turn and multi-turn chat via shared scenarios", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter
      .queueCreate({ steps: [token("Hello"), token(" world"), done()] })
      .queueCreate({ steps: [token("Reply one"), done()] })
      .queueResume({ steps: [token("Reply two"), done()] });
    const runtime = createClaudeRuntime(adapter);

    await runSingleTurnChatScenario(runtime);
    await runMultiTurnChatScenario(runtime);
  });

  it("covers tool success and tool failure persistence via shared scenarios", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter
      .queueCreate({
        steps: [toolStart("call-tool-1", "create_card"), toolResult("call-tool-1", "create_card", "ok"), token("tool finished"), done()],
      })
      .queueCreate({
        steps: [toolStart("call-tool-2", "edit_card"), toolResult("call-tool-2", "edit_card", "failed", true), token("recovered"), done()],
      });
    const runtime = createClaudeRuntime(adapter);

    await runToolSuccessScenario(runtime);
    await runToolFailureScenario(runtime);
  });

  it("covers cancellation via shared scenario", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [token("working"), waitForAbort()] });
    const runtime = createClaudeRuntime(adapter);

    await runCancellationScenario(runtime);
  });

  it("covers fatal failures and model listing via shared scenarios", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [fatal("Claude exploded")] });
    const runtime = createClaudeRuntime(adapter);

    await runFatalFailureScenario(runtime);
    await runModelListingScenario(runtime);
  });

  it("uses the resume path after the first task turn", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter
      .queueCreate({ steps: [reasoning("plan"), token("first"), done()] })
      .queueResume({ steps: [token("second"), done()] });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "First" });
    await runtime.waitForExecutionStatus(first.executionId, "completed");
    const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Second" });
    await runtime.waitForExecutionStatus(second.executionId, "completed");

    expect(adapter.trace.createCalls).toHaveLength(1);
    expect(adapter.trace.resumeCalls).toHaveLength(1);
  });

  it("transitions to waiting_user when Claude emits decision_request", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [{ kind: "emit", event: { type: "decision_request", payload: '{"questions":[{"question":"Decision?","type":"freetext"}]}' } }],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need interview" });
    await runtime.waitForExecutionStatus(result.executionId, "waiting_user");

    expect(runtime.getTaskState(taskId)).toBe("waiting_user");
  });
});

describe("Claude engine — systemInstructions propagation", () => {
  it("passes systemInstructions to ClaudeRunConfig, stage_instructions goes to prompt content", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [token("Done."), done()] });

    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    // task is in 'plan' state which has stage_instructions "You are a planning assistant."
    // Per the cache-invalidation fix, stage_instructions is no longer part of systemInstructions —
    // it is prepended to the prompt/userContent instead (systemInstructions stays stable across transitions).
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello" });
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const call = adapter.trace.createCalls[0];
    expect(call).toBeDefined();
    expect(call.systemInstructions).toBeUndefined();
    expect(call.prompt).toContain("You are a planning assistant.");
  });

  it("passes undefined systemInstructions when no instructions are configured", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [token("Done."), done()] });

    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    // Move to backlog which has no instructions
    runtime.db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello" });
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const call = adapter.trace.createCalls[0];
    expect(call).toBeDefined();
    expect(call.systemInstructions).toBeUndefined();
  });
});

describe("Claude engine — subagent scenarios", () => {
  it("CRS-SA-1: subagent lifecycle (start → tool → stop) completes end-to-end", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [
        subagentStart("sa-1", "read files", "Read src/auth.ts"),
        toolStart("call-sa-1", "Read", { path: "src/auth.ts" }),
        toolResult("call-sa-1", "Read", "file contents"),
        subagentStop("sa-1"),
        token("done"),
        done(),
      ],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "run" });
    await runtime.waitForExecutionStatus(executionId, "completed");
  });

  it("CRS-SA-2: subagent_start → subagent_stop events stream through without interrupting the run", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [subagentStart("sa-2", "investigate"), subagentStop("sa-2"), token("done"), done()],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
    // Subagent events are kept EngineEvent members; the run must complete normally
    // (no pause, no error). Persistence assertions died with the stream pipeline (07-01).
    await runtime.waitForExecutionStatus(executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
  });
});

describe("Claude — MCP discovery tools (dynamic-mcp-discovery)", () => {
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

    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [
        callTool("list_mcp_servers", {}),
        callTool("list_mcp_tools", { server: "alpha" }),
        callTool("invoke_mcp_tool", { server: "alpha", tool: "echo", arguments: {} }),
        done(),
      ],
    });
    const runtime = createClaudeRuntime(adapter, registryPool);

    await runMcpDiscoveryScenario(runtime);
  });
});
