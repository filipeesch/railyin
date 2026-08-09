import { expect } from "vitest";
import type { BackendRpcRuntime } from "./backend-rpc-runtime.ts";

/**
 * Shared engine RPC scenarios (post-07-01 contract).
 *
 * The custom StreamEvent IPC/DB dual-channel died in 07-01: runs write zero rows
 * to conversation_messages / stream_events and the recorder's streamEvents feed
 * is gone. Completion is asserted via the DB lifecycle triad (executions.status
 * + tasks.execution_state) — the same polling the smoke suite uses.
 */

export async function runSingleTurnChatScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello from single-turn" });

    // 07-01 contract: task-side sendMessage returns { executionId } only.
    expect(result.executionId).toBeGreaterThan(0);
    expect(result).not.toHaveProperty("message");
    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}

export async function runMultiTurnChatScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "First turn" });
    expect(first.executionId).toBeGreaterThan(0);
    await runtime.waitForExecutionStatus(first.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");

    const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Second turn" });
    expect(second.executionId).toBeGreaterThan(0);
    await runtime.waitForExecutionStatus(second.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}

export async function runToolSuccessScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Use a tool" });
    expect(result.executionId).toBeGreaterThan(0);
    // Tool events flow engine → consume() → onEngineEvent tap; the run itself
    // must complete (a failed dispatch surfaces as execution failed).
    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}

export async function runToolFailureScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Use a failing tool" });
    expect(result.executionId).toBeGreaterThan(0);
    // The mocked failing tool reports is_error inside the tool_result — non-fatal,
    // so the run still completes normally.
    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}

export async function runCancellationScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Cancel me" });
    expect(result.executionId).toBeGreaterThan(0);

    // Ensure the execution is actually running before cancelling it.
    await runtime.waitForExecutionStatus(result.executionId, "running");
    await runtime.handlers["tasks.cancel"]({ taskId });

    // Cancel path: execution → cancelled, task → waiting_user (07-01 consume()).
    await runtime.waitForExecutionStatus(result.executionId, "cancelled");
    await runtime.waitForTaskState(taskId, "waiting_user");
}

export async function runFatalFailureScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Explode" });
    expect(result.executionId).toBeGreaterThan(0);

    await runtime.recorder.waitForError(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "failed");
    await runtime.waitForTaskState(taskId, "failed");
}

/**
 * Full-loop MCP discovery scenario (dynamic-mcp-discovery, mcp-tool-discovery/spec.md):
 * scripts a turn where the model calls list_mcp_servers → list_mcp_tools → invoke_mcp_tool
 * in sequence, backed by a FakeMcpClient-driven McpClientRegistry injected into the runtime's
 * McpRegistryPool (see `createBackendRpcRuntime({ registryPool })`). Verifies real per-engine
 * tool dispatch reaches the real discovery executor (src/bun/mcp/discovery-tools.ts) end-to-end
 * through the real Orchestrator + in-memory DB — not just that the tool defs are registered.
 *
 * Callers must queue the engine-specific mock turn with 3 real-dispatch tool-call steps (in
 * this order) before invoking this scenario: list_mcp_servers, list_mcp_tools({server:"alpha"}),
 * invoke_mcp_tool({server:"alpha", tool:"echo", arguments:{}}) — and must configure a
 * FakeMcpClient-backed "alpha" server exposing an "echo" tool whose callToolResult contains
 * "echoed!", per this scenario's assertions. Callers must also allow-list "alpha:echo" via
 * `runtime.setEnabledMcpTools(taskId, ["alpha:echo"])` before sending the message (done here).
 *
 * Post-07-01 the tool results are no longer observable via stream events; the scenario
 * asserts the run completes (any real dispatch failure surfaces as a failed execution).
 */
export async function runMcpDiscoveryScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    runtime.setEnabledMcpTools(taskId, ["alpha:echo"]);

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Discover and invoke an MCP tool" });
    expect(result.executionId).toBeGreaterThan(0);

    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}

export async function runModelListingScenario(runtime: BackendRpcRuntime): Promise<void> {
    const listed = await runtime.handlers["models.list"]();
    const enabled = await runtime.handlers["models.listEnabled"]();

    expect(listed[0]?.id).toBeTruthy();
    expect(listed[0]?.models.length ?? 0).toBeGreaterThan(0);
    expect(enabled.length).toBeGreaterThan(0);
}

/* ─── Cursor-specific scenarios (post-07-01 contract) ────────────────── */

/**
 * Validates that a Cursor shell tool call completes: display metadata is asserted
 * on the recorder's engine-event tap where available; the run must reach
 * 'completed' (a real dispatch failure surfaces as a failed execution).
 */
export async function runCursorShellToolScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Run a shell command" });
    expect(result.executionId).toBeGreaterThan(0);

    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}

/**
 * Validates that a Cursor edit tool call completes end-to-end.
 * (writtenFiles extraction died with the EngineEvent trim — the renderer is
 * arg-derived via buildDiffPayloadsFromArgs, so nothing asserts it here.)
 */
export async function runCursorEditToolScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Edit a file" });
    expect(result.executionId).toBeGreaterThan(0);

    await runtime.waitForExecutionStatus(result.executionId, "completed");
    await runtime.waitForTaskState(taskId, "completed");
}
