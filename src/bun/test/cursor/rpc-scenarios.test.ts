import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
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

describe("Cursor slash-command resolution", () => {
    it("resolves slash prompt via dialect before sending to adapter; raw chip is stored in conversation_messages", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({ steps: [token("resolved response")] });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();

        // Write a .cursor/commands/ file in the task's worktree (gitDir)
        const cmdDir = join(runtime.gitDir, ".cursor", "commands");
        mkdirSync(cmdDir, { recursive: true });
        writeFileSync(join(cmdDir, "opsx-propose.md"), "Resolved body: $input", "utf-8");

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "[/opsx-propose|/opsx-propose] add-dark-mode",
        });
        await runtime.recorder.waitForStreamDone(result.executionId);

        // The adapter received the resolved XML body, not the raw slash chip
        const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
        expect(sentPrompt).toContain('<command name="opsx-propose"');
        expect(sentPrompt).toContain("Resolved body: add-dark-mode");
        expect(sentPrompt).not.toContain("[/opsx-propose|/opsx-propose]");

        // The raw chip was stored verbatim in conversation_messages
        const persisted = runtime.db
            .query<{ content: string; role: string | null }, [number]>(
                "SELECT content, role FROM conversation_messages WHERE task_id = ? AND type = 'user' ORDER BY id DESC LIMIT 1",
            )
            .get(taskId);
        expect(persisted?.role).toBe("user");
        expect(persisted?.content).toBe("[/opsx-propose|/opsx-propose] add-dark-mode");
    });
});
