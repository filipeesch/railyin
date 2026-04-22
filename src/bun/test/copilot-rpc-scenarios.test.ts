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
    toolCall,
} from "./support/copilot-sdk-mock.ts";
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
            new CopilotEngine(onTaskUpdated, onNewMessage, adapter),
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

    it("resumes the same execution after ask-user input", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(
                new MockCopilotSession()
                    .queueTurn({ steps: [askUser('{"questions":[{"question":"Need input","selection_mode":"single","options":[]}]}')] })
                    .queueTurn({ steps: [token("Resumed successfully"), done()] }),
            );
        const runtime = createCopilotRuntime(adapter);

        await runAskUserResumeScenario(runtime);
        expect(adapter.trace.createCalls).toHaveLength(1);
        expect(adapter.trace.resumeCalls).toHaveLength(1);
    });

    it("covers fatal failures and model listing via shared scenarios", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ sendError: new Error("SDK exploded"), steps: [] }));
        const runtime = createCopilotRuntime(adapter);

        await runFatalFailureScenario(runtime);
        await runModelListingScenario(runtime);

        const enabled = await runtime.handlers["models.listEnabled"]();
        expect(enabled[0]?.id).toBeNull();
        expect(enabled[0]?.displayName).toBe("Auto");
        expect(enabled[0]?.description ?? "").toContain("Copilot will automatically choose");
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
        // abortSession is called asynchronously after the DB update — poll until cleanup completes.
        await runtime.waitFor(() => adapter.trace.abortCalls >= 1, "adapter abortCalls >= 1");

        expect(adapter.trace.abortCalls).toBeGreaterThanOrEqual(1);
        expect(adapter.trace.disconnectCalls).toBeGreaterThanOrEqual(1);
        expect(session.abortCalls).toBeGreaterThanOrEqual(1);
        expect(session.disconnectCalls).toBeGreaterThanOrEqual(1);
    });

    it("transitions to waiting_user when interview_me is triggered via shared tool handler", async () => {
        const interviewArgs = {
            questions: [
                {
                    question: "Choose architecture",
                    type: "exclusive",
                    options: [{ title: "Option A", description: "Tradeoffs" }],
                },
            ],
        };
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("no session"))
            .queueCreateSuccess(
                new MockCopilotSession().queueTurn({ steps: [toolCall("interview_me", interviewArgs)] }),
            );
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need architecture input" });

        await runtime.waitForExecutionStatus(result.executionId, "waiting_user");
        expect(runtime.getTaskState(taskId)).toBe("waiting_user");
        expect(runtime.getMessages(taskId).some((message) => message.type === "interview_prompt")).toBe(true);
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
        expect(persisted?.metadata).toBeNull();
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

    it("emits structured writtenFiles and file_diff events for create/edit/apply_patch flows", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({
                steps: [
                    toolStart("call-tool-1", "create", { path: "src/new-file.ts", file_text: "export const x = 1;" }),
                    toolResult("call-tool-1", "created"),
                    toolStart("call-tool-2", "edit", { path: "src/new-file.ts", old_string: "x = 1", new_string: "x = 2" }),
                    toolResult("call-tool-2", "edited"),
                    toolStart("call-tool-3", "apply_patch", "*** Begin Patch\n*** Add File: src/added.ts\n+export const added = true;\n*** Update File: src/new-file.ts\n@@\n-export const x = 2;\n+export const x = 3;\n*** End Patch"),
                    toolResult("call-tool-3", "patched"),
                    token("done"),
                    done(),
                ],
            }));
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Edit files" });
        await runtime.recorder.waitForTokenDone(result.executionId);

        const toolResults = runtime.db
            .query<{ content: string }, [number]>(
                "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'tool_result' ORDER BY id ASC",
            )
            .all(taskId)
            .map((row) => JSON.parse(row.content) as { writtenFiles?: Array<{ operation: string; path: string }> });

        expect(toolResults).toHaveLength(3);
        expect(toolResults[0]?.writtenFiles?.[0]).toEqual({
            operation: "write_file",
            path: "src/new-file.ts",
            added: 0,
            removed: 0,
        });
        expect(toolResults[1]?.writtenFiles?.[0]).toEqual({
            operation: "edit_file",
            path: "src/new-file.ts",
            added: 0,
            removed: 0,
        });
        expect(toolResults[2]?.writtenFiles?.map((f) => `${f.operation}:${f.path}`)).toEqual([
            "write_file:src/added.ts",
            "patch_file:src/new-file.ts",
        ]);

        const fileDiffs = runtime.getDbStreamEvents(result.executionId)
            .filter((event) => event.type === "file_diff")
            .map((event) => JSON.parse(event.content) as { operation: string; path: string; added?: number; removed?: number });

        expect(fileDiffs.map((diff) => `${diff.operation}:${diff.path}`)).toEqual([
            "write_file:src/new-file.ts",
            "edit_file:src/new-file.ts",
            "write_file:src/added.ts",
            "patch_file:src/new-file.ts",
        ]);
        expect(fileDiffs.every((diff) => typeof diff.added === "number" && typeof diff.removed === "number")).toBe(true);
    });
});
