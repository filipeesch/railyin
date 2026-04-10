import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { CopilotEngine } from "../engine/copilot/engine.ts";
import type { BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { createBackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import {
    MockCopilotSdkAdapter,
    MockCopilotSession,
    askUser,
    done,
    reasoning,
    token,
    toolResult,
    toolResultWithOptions,
    toolStart,
    toolStartWithOptions,
    usage,
    waitForAbort,
} from "./support/copilot-sdk-mock.ts";
import {
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

function createCopilotRuntime(adapter: MockCopilotSdkAdapter): BackendRpcRuntime {
    adapter.setModels([
        {
            id: "mock-model",
            name: "Mock Model",
            capabilities: {
                limits: { max_context_window_tokens: 64000 },
                supports: { reasoningEffort: true },
            },
        },
    ]);

    const runtime = createBackendRpcRuntime({
        taskModel: "copilot/mock-model",
        createEngine: ({ onTaskUpdated, onNewMessage }) =>
            new CopilotEngine("copilot/mock-model", onTaskUpdated, onNewMessage, adapter),
    });
    runtimes.push(runtime);
    return runtime;
}

afterEach(() => {
    while (runtimes.length > 0) {
        runtimes.pop()!.cleanup();
    }
});

describe("Copilot backend RPC scenarios", () => {
    it("covers single-turn and multi-turn chat via shared scenarios", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("Hello"), token(" world"), usage(10, 20), done()] }))
            .queueResumeSuccess(new MockCopilotSession().queueTurn({ steps: [token("Reply one"), done()] }))
            .queueResumeSuccess(new MockCopilotSession().queueTurn({ steps: [token("Reply two"), done()] }));
        const runtime = createCopilotRuntime(adapter);

        await runSingleTurnChatScenario(runtime);
        await runMultiTurnChatScenario(runtime);
    });

    it("covers tool success and tool failure persistence via shared scenarios", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({
                steps: [toolStart("call-tool-1", "create_task"), toolResult("call-tool-1", "ok"), token("tool finished"), done()],
            }))
            .queueResumeSuccess(new MockCopilotSession().queueTurn({
                steps: [toolStart("call-tool-2", "edit_task"), toolResult("call-tool-2", "failed", false), token("recovered"), done()],
            }));
        const runtime = createCopilotRuntime(adapter);

        await runToolSuccessScenario(runtime);
        await runToolFailureScenario(runtime);
    });

    it("covers ask-user suspension and cancellation via shared scenarios", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("Need input"), askUser('{"question":"Need input"}')] }))
            .queueResumeSuccess(new MockCopilotSession().queueTurn({ steps: [token("streaming"), waitForAbort()] }));
        const runtime = createCopilotRuntime(adapter);

        await runAskUserScenario(runtime);
        await runCancellationScenario(runtime);
    });

    it("covers fatal failures and model listing via shared scenarios", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ sendError: new Error("SDK exploded"), steps: [] }));
        const runtime = createCopilotRuntime(adapter);

        await runFatalFailureScenario(runtime);
        await runModelListingScenario(runtime);
    });

    it("uses the resume path when a task session already exists", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter.queueResumeSuccess(
            new MockCopilotSession().queueTurn({ steps: [reasoning("plan"), token("done"), done()] }),
        );
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Resume existing" });
        await runtime.recorder.waitForTokenDone(result.executionId);

        expect(adapter.trace.resumeCalls).toHaveLength(1);
        expect(adapter.trace.createCalls).toHaveLength(0);
    });

    it("falls back to create when resume fails", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("no session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("created"), done()] }));
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Create fallback" });
        await runtime.recorder.waitForTokenDone(result.executionId);

        expect(adapter.trace.resumeCalls).toHaveLength(1);
        expect(adapter.trace.createCalls).toHaveLength(1);
    });

    it("aborts and disconnects the active session on cancellation", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("working"), waitForAbort()] });
        adapter
            .queueResumeFailure(new Error("no session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Cancel session" });
        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.waitForExecutionStatus(result.executionId, "cancelled");

        expect(adapter.trace.abortCalls).toBeGreaterThanOrEqual(1);
        expect(adapter.trace.disconnectCalls).toBeGreaterThanOrEqual(1);
        expect(session.abortCalls).toBeGreaterThanOrEqual(1);
        expect(session.disconnectCalls).toBeGreaterThanOrEqual(1);
    });

    it("stores raw slash prompts while executing the resolved prompt body", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("resolved"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const promptDir = join(runtime.gitDir, ".github", "prompts");
        mkdirSync(promptDir, { recursive: true });
        writeFileSync(join(promptDir, "opsx-propose.prompt.md"), "Resolved body: $input", "utf-8");

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "/opsx-propose add-dark-mode" });
        await runtime.recorder.waitForTokenDone(result.executionId);

        expect(session.prompts).toEqual(["Resolved body: add-dark-mode"]);
        const persisted = runtime.db
            .query<{ content: string; role: string | null; metadata: string | null }, [number]>(
                "SELECT content, role, metadata FROM conversation_messages WHERE task_id = ? AND type = 'user' ORDER BY id DESC LIMIT 1",
            )
            .get(taskId);
        expect(persisted?.role).toBe("user");
        expect(persisted?.content).toBe("/opsx-propose add-dark-mode");
        expect(JSON.parse(persisted?.metadata ?? "{}")).toEqual({
            display_content: "/opsx-propose add-dark-mode",
            resolved_content: "Resolved body: add-dark-mode",
        });
    });

    it("filters internal Copilot tool activity and preserves rich external tool results", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({
                steps: [
                    toolStartWithOptions("internal-1", "copilot_plan", {}, { source: "skill-planner" }),
                    toolResultWithOptions("internal-1", "", true, { detailedContent: "hidden", source: "skill-planner" }),
                    toolStart("call-tool-1", "run_command", { command: "git status" }),
                    toolResultWithOptions("call-tool-1", "", true, {
                        detailedContent: "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-console.log('old');\n+console.log('new');",
                        contents: [{ type: "text", text: "Applied patch to app.ts" }],
                    }),
                    token("done"),
                    done(),
                ],
            }));
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Show me the result" });
        await runtime.recorder.waitForTokenDone(result.executionId);

        const persistedTools = runtime.db
            .query<{ type: string; content: string }, [number]>(
                "SELECT type, content FROM conversation_messages WHERE task_id = ? AND type IN ('tool_call', 'tool_result') ORDER BY id ASC",
            )
            .all(taskId);
        expect(persistedTools).toHaveLength(2);
        expect(persistedTools.map((row) => row.type)).toEqual(["tool_call", "tool_result"]);

        const toolCall = JSON.parse(persistedTools[0]!.content) as {
            function?: { name?: string; arguments?: string };
        };
        expect(toolCall.function?.name).toBe("run_command");

        const toolResultPayload = JSON.parse(persistedTools[1]!.content) as {
            content?: string;
            detailedContent?: string;
            contents?: Array<Record<string, unknown>>;
            is_error?: boolean;
        };
        expect(toolResultPayload.is_error).toBe(false);
        expect(toolResultPayload.content).toBe("");
        expect(toolResultPayload.detailedContent).toContain("@@ -1 +1 @@");
        expect(toolResultPayload.contents).toEqual([{ type: "text", text: "Applied patch to app.ts" }]);
    });
});
