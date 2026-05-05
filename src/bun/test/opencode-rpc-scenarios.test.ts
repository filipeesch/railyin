import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeEngine } from "../engine/opencode/engine.ts";
import type { BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { createBackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import {
  MockOpenCodeSdkAdapter,
  askUser,
  done,
  fatal,
  reasoning,
  shellApproval,
  token,
  toolResult,
  toolStart,
  usage,
  waitForAbort,
} from "./support/opencode-sdk-mock.ts";
import {
  runAskUserScenario,
  runAskUserResumeScenario,
  runCancellationScenario,
  runFatalFailureScenario,
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

function createOpenCodeRuntime(adapter: MockOpenCodeSdkAdapter): BackendRpcRuntime {
  adapter.setModels([QUALIFIED_MODEL]);

  const runtime = createBackendRpcRuntime({
    taskModel: TASK_MODEL,
    createEngine: ({ onTaskUpdated, onNewMessage }) =>
      new OpenCodeEngine(onTaskUpdated, onNewMessage, adapter),
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
      .queueCreate({ steps: [token("Hello"), token(" world"), usage(10, 20), done()] })
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
        steps: [toolStart("call-tool-1", "create_task"), toolResult("call-tool-1", "create_task", "ok"), token("tool finished"), done()],
      })
      .queueCreate({
        steps: [toolStart("call-tool-2", "edit_task"), toolResult("call-tool-2", "edit_task", "failed", true), token("recovered"), done()],
      });
    const runtime = createOpenCodeRuntime(adapter);

    await runToolSuccessScenario(runtime);
    await runToolFailureScenario(runtime);
  });

  it("covers ask-user suspension via shared scenario", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    // No preceding token — ask_user is the first event so no assistant message is flushed
    adapter.queueCreate({ steps: [askUser('{"question":"Need input"}')] });
    const runtime = createOpenCodeRuntime(adapter);

    await runAskUserScenario(runtime);
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
    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const messages = runtime.getMessages(taskId);
    const hasReasoning = messages.some((m) => m.type === "reasoning" || m.content?.includes("internal plan"));
    expect(hasReasoning).toBe(true);
  });
});

// ── OpenCode-specific: ask_user resume (same execution continues) ─────────────

describe("OpenCode ask_user resume", () => {
  it("resumes after ask-user with the same execution (same executionId)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    // Single script: blocks at ask_user, then continues with reply after respondAskUser()
    adapter.queueCreate({
      steps: [
        askUser('{"question":"Which option?","options":["A","B"]}'),
        token("Continuing with option A"),
        done(),
      ],
    });

    const runtime = createOpenCodeRuntime(adapter);
    await runAskUserResumeScenario(runtime);
  });
});

// ── OpenCode-specific: shell_approval pause/resume ───────────────────────────

describe("OpenCode shell_approval", () => {
  it("pauses execution waiting for shell approval and resumes after approval", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({
      steps: [shellApproval("npm test"), token("Running tests..."), done()],
    });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Run the test suite" });
    await runtime.waitForExecutionStatus(result.executionId, "waiting_user");

    expect(runtime.getMessages(taskId).some(
      (m) => m.type === "ask_user_prompt" && m.content.includes('"subtype":"shell_approval"'),
    )).toBe(true);

    await runtime.handlers["tasks.respondShellApproval"]({ taskId, decision: "approve_once" });
    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");
  });

  it("cancels execution when shell approval is denied", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({
      steps: [shellApproval("rm -rf /"), token("This should not appear"), done()],
    });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Delete everything" });
    await runtime.waitForExecutionStatus(result.executionId, "waiting_user");

    await runtime.handlers["tasks.respondShellApproval"]({ taskId, decision: "deny" });
    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");
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
    await runtime.recorder.waitForStreamDone(result.executionId);

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
    await runtime.recorder.waitForStreamDone(first.executionId);
    await runtime.waitForExecutionStatus(first.executionId, "completed");

    const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Second" });
    await runtime.recorder.waitForStreamDone(second.executionId);

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

    await runtime.recorder.waitForStreamDone(r1.executionId);
    await runtime.recorder.waitForStreamDone(r2.executionId);

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
    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    expect(adapter.activeContexts.size).toBe(0);
  });

  it("cleans up activeContexts after fatal error execution (task 6.5)", async () => {
    const adapter = new MockOpenCodeSdkAdapter();
    adapter.queueCreate({ steps: [fatal("something went wrong")] });
    const runtime = createOpenCodeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Explode" });
    await runtime.recorder.waitForStreamDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "failed");

    expect(adapter.activeContexts.size).toBe(0);
  });
});
