import { expect } from "bun:test";
import type { BackendRpcRuntime } from "./backend-rpc-runtime.ts";

export async function runSingleTurnChatScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello from single-turn" });

    expect(result.message.content).toBe("Hello from single-turn");
    await runtime.recorder.waitForTokenDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const messages = runtime.getMessages(taskId);
    expect(messages.at(-2)?.type).toBe("user");
    expect(messages.at(-2)?.content).toBe("Hello from single-turn");
    expect(messages.at(-1)?.type).toBe("assistant");
    expect(messages.at(-1)?.content.length ?? 0).toBeGreaterThan(0);
}

export async function runMultiTurnChatScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "First turn" });
    await runtime.recorder.waitForTokenDone(first.executionId);
    await runtime.waitForExecutionStatus(first.executionId, "completed");

    const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Second turn" });
    await runtime.recorder.waitForTokenDone(second.executionId);
    await runtime.waitForExecutionStatus(second.executionId, "completed");

    const tail = runtime.getMessages(taskId).slice(-4).map((message) => [message.type, message.content]);
    expect(tail).toEqual([
        ["user", "First turn"],
        ["assistant", tail[1][1]],
        ["user", "Second turn"],
        ["assistant", tail[3][1]],
    ]);
}

export async function runToolSuccessScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Use a tool" });
    await runtime.recorder.waitForTokenDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const messages = runtime.getMessages(taskId);
    const toolCall = messages.find((message) => message.type === "tool_call");
    const toolResult = messages.find((message) => message.type === "tool_result");
    const assistant = messages.at(-1);

    expect(toolCall).toBeDefined();
    expect(toolResult).toBeDefined();
    expect(toolCall?.content).toContain("call-tool-1");
    expect(toolResult?.content).toContain("call-tool-1");
    expect(assistant?.type).toBe("assistant");
}

export async function runToolFailureScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Use a failing tool" });
    await runtime.recorder.waitForTokenDone(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "completed");

    const toolResult = runtime.getMessages(taskId).find((message) => message.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult?.content).toContain('"is_error":true');
    expect(runtime.getMessages(taskId).at(-1)?.type).toBe("assistant");
}

export async function runAskUserScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need clarification" });

    await runtime.waitForExecutionStatus(result.executionId, "waiting_user");
    await runtime.waitForTaskState(taskId, "waiting_user");

    const messages = runtime.getMessages(taskId);
    expect(messages.filter((message) => message.type === "assistant")).toHaveLength(0);
}

export async function runCancellationScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Cancel me" });

    await runtime.recorder.waitForAnyToken(result.executionId);
    const tokenCountBeforeCancel = runtime.recorder.tokenEvents.filter((event) => event.executionId === result.executionId).length;
    await runtime.handlers["tasks.cancel"]({ taskId });
    await runtime.waitForExecutionStatus(result.executionId, "cancelled");
    await runtime.waitForTaskState(taskId, "waiting_user");
    const tokenCountAfterCancel = await runtime.recorder.waitForStableTokenCount(result.executionId);

    expect(tokenCountAfterCancel).toBeGreaterThanOrEqual(tokenCountBeforeCancel);
    expect(runtime.getMessages(taskId).filter((message) => message.type === "assistant")).toHaveLength(0);
}

export async function runFatalFailureScenario(runtime: BackendRpcRuntime): Promise<void> {
    const { taskId } = await runtime.createTask();
    const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Explode" });

    await runtime.recorder.waitForError(result.executionId);
    await runtime.waitForExecutionStatus(result.executionId, "failed");
    await runtime.waitForTaskState(taskId, "failed");
    expect(runtime.getMessages(taskId).filter((message) => message.type === "assistant")).toHaveLength(0);
}

export async function runModelListingScenario(runtime: BackendRpcRuntime): Promise<void> {
    const listed = await runtime.handlers["models.list"]();
    const enabled = await runtime.handlers["models.listEnabled"]();

    expect(listed[0]?.id).toBe("copilot");
    expect(listed[0]?.models.length ?? 0).toBeGreaterThan(0);
    expect(enabled.length).toBeGreaterThan(0);
}
