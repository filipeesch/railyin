import { afterEach, describe, expect, it } from "vitest";
import { ClaudeEngine } from "../engine/claude/engine.ts";
import type { BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { createBackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import {
  MockClaudeSdkAdapter,
  askUser,
  done,
  fatal,
  reasoning,
  shellApproval,
  subagentStart,
  subagentStop,
  token,
  toolResult,
  toolStart,
  usage,
  waitForAbort,
} from "./support/claude-sdk-mock.ts";
import {
  runAskUserResumeScenario,
  runAskUserScenario,
  runCancellationScenario,
  runFatalFailureScenario,
  runModelListingScenario,
  runMultiTurnChatScenario,
  runSingleTurnChatScenario,
  runToolFailureScenario,
  runToolSuccessScenario,
} from "./support/shared-rpc-scenarios.ts";

const runtimes: BackendRpcRuntime[] = [];

function createClaudeRuntime(adapter: MockClaudeSdkAdapter): BackendRpcRuntime {
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
    createEngine: ({ onTaskUpdated, onNewMessage }) =>
      new ClaudeEngine("claude-sonnet-4-6", onTaskUpdated, onNewMessage, adapter),
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
      .queueCreate({ steps: [token("Hello"), token(" world"), usage(10, 20), done()] })
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

  it("covers ask-user suspension via shared scenario", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [token("Need input"), askUser('{"question":"Need input"}')] });
    const runtime = createClaudeRuntime(adapter);

    await runAskUserScenario(runtime);
  });

  it("covers cancellation via shared scenario", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [token("working"), waitForAbort()] });
    const runtime = createClaudeRuntime(adapter);

    await runCancellationScenario(runtime);
  });

  it("resumes the same execution after ask-user input", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [askUser('{"questions":[{"question":"Need input","selection_mode":"single","options":[]}]}'), token("Resumed successfully"), done()] });
    const runtime = createClaudeRuntime(adapter);

    await runAskUserResumeScenario(runtime);
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
    await runtime.recorder.waitForStreamDone(first.executionId);
    const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Second" });
    await runtime.recorder.waitForStreamDone(second.executionId);

    expect(adapter.trace.createCalls).toHaveLength(1);
    expect(adapter.trace.resumeCalls).toHaveLength(1);
  });

  it("surfaces shell approval pauses and resumes after approval", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [shellApproval("npm test"), token("Approved and continued"), done()],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Run a shell command" });
    await runtime.waitForExecutionStatus(first.executionId, "waiting_user");
    expect(runtime.getMessages(taskId).some((message) => message.type === "ask_user_prompt" && message.content.includes('"subtype":"shell_approval"'))).toBe(true);

    await runtime.handlers["executions.respondShellApproval"]({ executionId: first.executionId, decision: "approve_once" });
    await runtime.recorder.waitForStreamDone(first.executionId);
    await runtime.waitForExecutionStatus(first.executionId, "completed");
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
    expect(runtime.getMessages(taskId).some((message) => message.type === "decision_request_prompt")).toBe(true);
  });
});

describe("Claude engine — systemInstructions propagation", () => {
  it("passes systemInstructions to ClaudeRunConfig", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({ steps: [token("Done."), done()] });

    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    // task is in 'plan' state which has stage_instructions "You are a planning assistant."
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello" });
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const call = adapter.trace.createCalls[0];
    expect(call).toBeDefined();
    expect(call.systemInstructions).toBe("You are a planning assistant.");
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
  it("CRS-SA-1: subagent lifecycle (start → tool → stop) completes end-to-end without shell_approval pause", async () => {
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
    await runtime.recorder.waitForStreamDone(executionId);
    await runtime.waitForExecutionStatus(executionId, "completed");

    // Execution completed without hitting waiting_user — no shell_approval pause
    const messages = runtime.getMessages(taskId);
    expect(messages.some((m) => m.type === "ask_user_prompt" && m.content.includes('"subtype":"shell_approval"'))).toBe(false);
  });

  it("CRS-SA-2: subagent Bash with unapproved binary emits shell_approval and resumes on approval", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [subagentStart("sa-2", "install deps"), shellApproval("bun install"), token("installed"), done()],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "install" });
    await runtime.waitForExecutionStatus(executionId, "waiting_user");

    expect(runtime.getMessages(taskId).some((m) => m.type === "ask_user_prompt" && m.content.includes('"subtype":"shell_approval"'))).toBe(true);

    await runtime.handlers["executions.respondShellApproval"]({ executionId, decision: "approve_once" });
    await runtime.recorder.waitForStreamDone(executionId);
    await runtime.waitForExecutionStatus(executionId, "completed");
  });

  it("CRS-SA-3: subagent_start is persisted as tool_call conversation message with subagentId", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [subagentStart("sa-3", "read files", "Read src/auth.ts"), token("done"), done()],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
    await runtime.recorder.waitForStreamDone(executionId);

    // IPC should include a tool_call block with subagentId=sa-3
    const ipc = runtime.getIpcEvents(executionId);
    const subagentBlock = ipc.find((e) => e.type === "tool_call" && e.subagentId === "sa-3");
    expect(subagentBlock).toBeDefined();
    expect(subagentBlock?.blockId).toBe("sa-3");

    // Durable store should also persist a tool_call message for this subagent call
    const durableMessages = await runtime.getDurableMessages(executionId);
    const durableBlock = durableMessages.find((m) => m.type === "tool_call" && m.content.includes("sa-3"));
    expect(durableBlock).toBeDefined();
  });

  it("CRS-SA-4: subagent_stop is persisted as tool_result message matching the subagent callId", async () => {
    const adapter = new MockClaudeSdkAdapter();
    adapter.queueCreate({
      steps: [subagentStart("sa-4", "investigate"), subagentStop("sa-4"), token("done"), done()],
    });
    const runtime = createClaudeRuntime(adapter);
    const { taskId } = await runtime.createTask();

    const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
    await runtime.recorder.waitForStreamDone(executionId);

    const ipc = runtime.getIpcEvents(executionId);
    // subagent_stop should emit a done=true tool_result block with blockId=sa-4
    const stopBlock = ipc.find((e) => e.type === "tool_result" && e.blockId === "sa-4" && e.subagentId === "sa-4");
    expect(stopBlock).toBeDefined();
    expect(stopBlock?.done).toBe(true);

    // Durable store should also persist the tool_result for this subagent call
    const durableMessages = await runtime.getDurableMessages(executionId);
    const durableStop = durableMessages.find((m) => m.type === "tool_result" && m.content.includes("sa-4"));
    expect(durableStop).toBeDefined();
  });
});
