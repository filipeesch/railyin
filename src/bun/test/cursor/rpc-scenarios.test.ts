import { afterEach, describe, expect, it } from "vitest";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime.ts";
import type { BackendRpcRuntime } from "@bun/test/support/backend-rpc-runtime.ts";
import {
    MockCursorSdkAdapter,
    callTool,
    fatalError,
    token,
    toolResult,
    toolStart,
    waitForAbort,
} from "./mocks.ts";
import {
    runCancellationScenario,
    runFatalFailureScenario,
    runModelListingScenario,
    runMultiTurnChatScenario,
    runSingleTurnChatScenario,
    runToolFailureScenario,
    runToolSuccessScenario,
} from "@bun/test/support/shared-rpc-scenarios.ts";

const runtimes: BackendRpcRuntime[] = [];

function createRuntime(adapter: MockCursorSdkAdapter): BackendRpcRuntime {
    const runtime = createCursorRpcRuntime(adapter);
    runtimes.push(runtime);
    return runtime;
}

afterEach(() => {
    while (runtimes.length > 0) runtimes.pop()!.cleanup();
});

describe("Cursor backend RPC scenarios", () => {
    it("§6.3.1 + §6.3.2 — single-turn and multi-turn chat via shared scenarios", async () => {
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({ steps: [token("Hello"), token(" world")] })
            .queueTurn({ steps: [token("Reply one")] })
            .queueTurn({ steps: [token("Reply two")] });
        const runtime = createRuntime(adapter);

        await runSingleTurnChatScenario(runtime);
        await runMultiTurnChatScenario(runtime);
    });

    it("§6.3.3 + §6.3.4 — tool success and failure via shared scenarios", async () => {
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({
                steps: [
                    toolStart("call-tool-1", "create_card"),
                    toolResult("call-tool-1", "ok"),
                    token("tool finished"),
                ],
            })
            .queueTurn({
                steps: [
                    toolStart("call-tool-2", "edit_card"),
                    toolResult("call-tool-2", "failed", false),
                    token("recovered"),
                ],
            });
        const runtime = createRuntime(adapter);

        await runToolSuccessScenario(runtime);
        await runToolFailureScenario(runtime);
    });

    it("§6.3.5a — decision_request via callTool persists a decision_request_prompt", async () => {
        const interviewArgs = {
            questions: [
                {
                    question: "Choose architecture",
                    type: "exclusive",
                    options: [
                        { title: "Option A", description: "Tradeoffs" },
                        { title: "Option B", description: "Alternative tradeoffs" },
                    ],
                },
            ],
        };
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [callTool("decision_request", interviewArgs)],
        });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need architecture input" });
        await runtime.waitForExecutionStatus(result.executionId, "waiting_user");

        expect(runtime.getTaskState(taskId)).toBe("waiting_user");
        expect(runtime.getMessages(taskId).some((m) => m.type === "decision_request_prompt")).toBe(true);
    });

    it("§6.3.5b — sending a follow-up message after decision_request restarts as a fresh execution", async () => {
        // Cursor's engine.resume() throws by contract — HumanTurnExecutor falls
        // into its restart branch and starts a brand-new execution.
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({
                steps: [callTool("decision_request", {
                    questions: [{ question: "A or B?", type: "freetext" }],
                })],
            })
            .queueTurn({ steps: [token("Resumed with new execution")] });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need clarification" });
        await runtime.waitForExecutionStatus(first.executionId, "waiting_user");

        const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Use option A" });
        // Cursor restarts — second execution id is new, NOT the first.
        expect(second.executionId).not.toBe(first.executionId);

        await runtime.recorder.waitForStreamDone(second.executionId);
        await runtime.waitForExecutionStatus(second.executionId, "completed");

        const tail = runtime.getMessages(taskId).slice(-2).map((m) => m.type);
        expect(tail).toEqual(["user", "assistant"]);
    });

    it("§6.3.6 — cancellation via shared scenario", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [token("streaming"), waitForAbort()],
        });
        const runtime = createRuntime(adapter);

        await runCancellationScenario(runtime);
    });

    it("§6.3.7 — fatal failure via shared scenario", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            sendError: new Error("Cursor SDK exploded"),
            steps: [],
        });
        const runtime = createRuntime(adapter);

        await runFatalFailureScenario(runtime);
    });

    it("§6.3.7b — fatal failure via streamed error event also surfaces as failed", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [token("partial"), fatalError("agent crashed mid-stream")],
        });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Explode mid-stream" });
        await runtime.recorder.waitForError(result.executionId);
        await runtime.waitForExecutionStatus(result.executionId, "failed");
        await runtime.waitForTaskState(taskId, "failed");
    });

    it("§6.3.8 — model listing via shared scenario", async () => {
        const adapter = new MockCursorSdkAdapter();
        const runtime = createRuntime(adapter);

        await runModelListingScenario(runtime);
        expect(adapter.trace.listModelsCalls).toBeGreaterThan(0);
    });
});
