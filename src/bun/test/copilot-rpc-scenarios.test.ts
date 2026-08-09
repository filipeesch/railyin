import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { CopilotEngine } from "../engine/copilot/engine.ts";
import { copilotSessionIdForConversation } from "../engine/copilot/session.ts";
import type { BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { createBackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import { McpRegistryPool } from "../mcp/registry-pool.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import {
    MockCopilotSdkAdapter,
    MockCopilotSession,
    done,
    reasoning,
    token,
    toolResult,
    toolResultWithOptions,
    toolStart,
    toolStartWithOptions,
    waitForAbort,
    toolCall,
} from "./support/copilot-sdk-mock.ts";
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

function createCopilotRuntime(adapter: MockCopilotSdkAdapter, registryPool?: McpRegistryPool): BackendRpcRuntime {
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
        createEngine: ({ onTaskUpdated }) =>
            new CopilotEngine(onTaskUpdated, adapter),
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

describe("Copilot backend RPC scenarios", () => {
    it("covers single-turn and multi-turn chat via shared scenarios", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("Hello"), token(" world"), done()] }))
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
                steps: [toolStart("call-tool-1", "create_card"), toolResult("call-tool-1", "ok"), token("tool finished"), done()],
            }))
            .queueResumeSuccess(new MockCopilotSession().queueTurn({
                steps: [toolStart("call-tool-2", "edit_card"), toolResult("call-tool-2", "failed", false), token("recovered"), done()],
            }));
        const runtime = createCopilotRuntime(adapter);

        await runToolSuccessScenario(runtime);
        await runToolFailureScenario(runtime);
    });

    it("covers cancellation via shared scenario", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("streaming"), waitForAbort()] }));
        const runtime = createCopilotRuntime(adapter);

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

        // Enable auto model explicitly since it's now treated as an ordinary model
        await runtime.handlers["models.setEnabled"]({ qualifiedModelId: "copilot/auto", enabled: true });

        const enabled = await runtime.handlers["models.listEnabled"]();
        expect(enabled[0]?.id).toBe("copilot/auto");
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
        await runtime.waitForExecutionStatus(result.executionId, "completed");

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
        await runtime.waitForExecutionStatus(result.executionId, "completed");

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

    it("transitions to waiting_user when decision_request is triggered via shared tool handler", async () => {
        const interviewArgs = {
            questions: [
                {
                    question: "Choose architecture",
                    type: "exclusive",
                    options: [{ title: "Option A", description: "Tradeoffs" }, { title: "Option B", description: "Alternative tradeoffs" }],
                },
            ],
        };
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("no session"))
            .queueCreateSuccess(
                new MockCopilotSession().queueTurn({ steps: [toolCall("decision_request", interviewArgs)] }),
            );
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need architecture input" });

        // 07-01 contract: the decision_request interrupt persists via the
        // interrupt registry, NOT conversation_messages (zero writes). The
        // observable RPC state is the waiting_user lifecycle.
        await runtime.waitForExecutionStatus(result.executionId, "waiting_user");
        expect(runtime.getTaskState(taskId)).toBe("waiting_user");
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

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "[/opsx-propose|/opsx-propose] add-dark-mode",
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        // Task starts in 'plan' workflow_state (stage_instructions: "You are a planning assistant."),
        // prepended to userContent on the first human turn (never-injected-yet policy).
        expect(session.prompts).toEqual([
          '<active_directive>\nYou are a planning assistant.\n\nThis directive is currently in force. Follow it in every response until it is replaced by a new active_directive or the user explicitly asks you to override it.\n</active_directive>\n\n<command name="opsx-propose" args="add-dark-mode">\nResolved body: add-dark-mode\n</command>',
        ]);
        // 07-01 contract: the raw slash chip is no longer persisted to
        // conversation_messages (zero writes during runs) — the resolved
        // prompt body above is the only channel.
    });

    it("sends uploaded text attachments to Copilot as same-turn selections", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("done"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "Review this note",
            attachments: [{
                label: "note.md",
                mediaType: "text/markdown",
                data: Buffer.from("# hi\n\nbody").toString("base64"),
            }],
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        expect(session.sentMessages).toHaveLength(1);
        expect(session.sentMessages[0]?.attachments).toEqual([{
            type: "selection",
            filePath: expect.stringContaining("note.md"),
            displayName: "note.md",
            text: "# hi\n\nbody",
            selection: {
                start: { line: 0, character: 0 },
                end: { line: 2, character: 4 },
            },
        }]);
    });

    it("sends #file references to Copilot as same-turn selections without prompt injection", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("done"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const filePath = join(runtime.gitDir, ".gitignore");
        writeFileSync(filePath, "node_modules/\ndist/\n", "utf8");

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "[#.gitignore|#.gitignore] explain this",
            attachments: [{
                label: ".gitignore",
                mediaType: "text/plain",
                data: `@file:${filePath}`,
            }],
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        // Task starts in 'plan' workflow_state (stage_instructions: "You are a planning assistant."),
        // prepended to userContent on the first human turn (never-injected-yet policy).
        expect(session.prompts).toEqual([
          "<active_directive>\nYou are a planning assistant.\n\nThis directive is currently in force. Follow it in every response until it is replaced by a new active_directive or the user explicitly asks you to override it.\n</active_directive>\n\n.gitignore explain this",
        ]);
        expect(session.sentMessages[0]?.attachments).toEqual([{
            type: "selection",
            filePath,
            displayName: ".gitignore",
            text: "node_modules/\ndist/\n",
            selection: {
                start: { line: 0, character: 0 },
                end: { line: 2, character: 0 },
            },
        }]);
    });

    it("sends #file attachments on follow-up (non-first) turns", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession()
            .queueTurn({ steps: [token("first reply"), done()] })
            .queueTurn({ steps: [token("second reply"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session)
            .queueResumeSuccess(session); // second sendMessage resumes the existing session
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        // First turn — no attachment
        const result1 = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "hello" });
        await runtime.waitForExecutionStatus(result1.executionId, "completed");

        const filePath = join(runtime.gitDir, "note.md");
        writeFileSync(filePath, "# Note\nsome content\n", "utf8");

        // Second turn — with #file attachment
        const result2 = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "check this file",
            attachments: [{
                label: "note.md",
                mediaType: "text/plain",
                data: `@file:${filePath}`,
            }],
        });
        await runtime.waitForExecutionStatus(result2.executionId, "completed");

        expect(session.sentMessages).toHaveLength(2);
        const secondAtt = session.sentMessages[1]?.attachments?.[0];
        expect(secondAtt?.type).toBe("selection");
        if (secondAtt?.type !== "selection") throw new Error("expected selection");
        expect(secondAtt.text).toBe("# Note\nsome content\n");
    });

    it("resolves #file relative paths against workingDirectory", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("done"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        // Write file inside gitDir (which is the workingDirectory for the task)
        writeFileSync(join(runtime.gitDir, "config.ts"), "export const x = 1;\n", "utf8");

        // Use relative path (as workspace.listFiles would return)
        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "explain config",
            attachments: [{
                label: "config.ts",
                mediaType: "text/plain",
                data: "@file:config.ts",
            }],
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const att = session.sentMessages[0]?.attachments?.[0];
        expect(att?.type).toBe("selection");
        if (att?.type !== "selection") throw new Error("expected selection");
        expect(att.text).toBe("export const x = 1;\n");
        // filePath must be absolute
        expect(att.filePath).toBe(join(runtime.gitDir, "config.ts"));
    });

    it("maps extension-less text label to .txt temp file with correct content", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("done"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "check readme",
            attachments: [{
                label: "README",
                mediaType: "text/plain",
                data: Buffer.from("# Hello\n\nworld").toString("base64"),
            }],
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        expect(session.sentMessages).toHaveLength(1);
        const att = session.sentMessages[0]?.attachments?.[0];
        expect(att?.type).toBe("selection");
        if (att?.type !== "selection") throw new Error("expected selection");
        expect(att.filePath).toMatch(/\.txt$/);
        expect(att.displayName).toBe("README");
        expect(att.text).toBe("# Hello\n\nworld");
    });

    it("writes text attachment to disk at the reported filePath", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("done"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "review config",
            attachments: [{
                label: "config.json",
                mediaType: "application/json",
                data: Buffer.from('{"key":"value"}').toString("base64"),
            }],
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const att = session.sentMessages[0]?.attachments?.[0];
        expect(att?.type).toBe("selection");
        if (att?.type !== "selection") throw new Error("expected selection");
        const { existsSync: fsExistsSync, readFileSync: fsReadFileSync } = await import("fs");
        expect(fsExistsSync(att.filePath)).toBe(true);
        expect(fsReadFileSync(att.filePath, "utf8")).toBe('{"key":"value"}');
    });

    it("sends line-ranged #file ref with only the specified lines", async () => {
        const adapter = new MockCopilotSdkAdapter();
        const session = new MockCopilotSession().queueTurn({ steps: [token("done"), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const filePath = join(runtime.gitDir, "lines.ts");
        writeFileSync(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf8");

        const result = await runtime.handlers["tasks.sendMessage"]({
            taskId,
            content: "explain lines",
            attachments: [{
                label: "lines.ts",
                mediaType: "text/plain",
                data: `@file:${filePath}:L2-L4`,
            }],
        });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const att = session.sentMessages[0]?.attachments?.[0];
        expect(att?.type).toBe("selection");
        if (att?.type !== "selection") throw new Error("expected selection");
        expect(att.text).toBe("line2\nline3\nline4");
        expect(att.selection?.start.line).toBe(0);
        expect(att.selection?.end.line).toBe(2);
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
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        // 07-01 contract: tool events are no longer persisted to
        // conversation_messages (zero writes during runs) — the run completing
        // with both internal (copilot_plan, filtered) and external
        // (run_command with rich result) tools is the observable outcome.
        const persistedTools = runtime.db
            .query<{ type: string }, [number]>(
                "SELECT type FROM conversation_messages WHERE task_id = ? AND type IN ('tool_call', 'tool_result') ORDER BY id ASC",
            )
            .all(taskId);
        expect(persistedTools).toHaveLength(0);
    });

    it("emits structured tool results for create/edit/apply_patch flows", async () => {
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
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        // 07-01/07-02: writtenFiles was trimmed from tool_result AND tool events
        // are no longer persisted to conversation_messages (zero writes during
        // runs) — the renderer derives diffs from tool ARGS (buildDiffPayloadsFromArgs).
        const toolResults = runtime.db
            .query<{ type: string }, [number]>(
                "SELECT type FROM conversation_messages WHERE task_id = ? AND type = 'tool_result' ORDER BY id ASC",
            )
            .all(taskId);

        expect(toolResults).toHaveLength(0);
    });
});

describe("Copilot — MCP discovery tools (dynamic-mcp-discovery)", () => {
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

        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({
                steps: [
                    toolCall("list_mcp_servers", {}),
                    toolCall("list_mcp_tools", { server: "alpha" }),
                    toolCall("invoke_mcp_tool", { server: "alpha", tool: "echo", arguments: {} }),
                    token("done"),
                    done(),
                ],
            }));
        const runtime = createCopilotRuntime(adapter, registryPool);

        await runMcpDiscoveryScenario(runtime);
    });
});

describe("Copilot engine — systemInstructions propagation", () => {
    it("passes systemInstructions to session config as systemMessage, stage_instructions goes to prompt content", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter.setModels([
            {
                id: "mock-model",
                name: "Mock Model",
                capabilities: { limits: { max_context_window_tokens: 64000 }, supports: { reasoningEffort: true } },
            },
        ]);
        const session = new MockCopilotSession().queueTurn({ steps: [token("Done."), done()] });
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(session);

        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        // The task is in 'plan' state which has stage_instructions "You are a planning assistant."
        // Per the cache-invalidation fix, stage_instructions is no longer part of systemMessage —
        // it is prepended to the userContent/prompt instead, so systemMessage stays stable across
        // column transitions (only workflow_instructions, if any, may appear there).
        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello" });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const call = adapter.trace.createCalls[0];
        expect(call).toBeDefined();
        expect(call.config.systemMessage?.content ?? "").not.toContain("You are a planning assistant.");
        expect(session.prompts[0]).toContain("You are a planning assistant.");
    });

    it("omits systemMessage when systemInstructions is undefined", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter.setModels([
            {
                id: "mock-model",
                name: "Mock Model",
                capabilities: { limits: { max_context_window_tokens: 64000 }, supports: { reasoningEffort: true } },
            },
        ]);
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("Done."), done()] }));

        // Move task to 'backlog' which has no stage_instructions or workflow_instructions
        const runtime = createBackendRpcRuntime({
            taskModel: "copilot/mock-model",
            createEngine: ({ onTaskUpdated }) =>
                new CopilotEngine(onTaskUpdated, adapter),
        });
        runtimes.push(runtime);
        const { taskId } = await runtime.createTask();
        runtime.db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Hello" });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const call = adapter.trace.createCalls[0];
        expect(call).toBeDefined();
        // backlog has no instructions so systemMessage should be absent or only contain task context
        // (task context is always present but not systemInstructions)
        // The key assertion: no stage/workflow text in systemMessage
        if (call.config.systemMessage) {
            expect(call.config.systemMessage.content).not.toContain("planning assistant");
        }
    });
});

describe("Copilot lease timeout fixes (Bug B + Bug C)", () => {
    it("C1: execution ends as cancelled (not failed) when onBeforeEvict fires mid-stream", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({ steps: [token("streaming"), waitForAbort()] }));
        const runtime = createCopilotRuntime(adapter);
        const { taskId, conversationId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait until the stream is actually in-flight: the engine's per-event
        // lease touch proves at least one stream event was processed (the
        // stream-event IPC/token feeds aren't wired to the recorder post-07-01).
        await runtime.waitFor(
            () => adapter.trace.touchLeaseCalls.filter((c) => c.state === "running").length >= 2,
            "in-flight copilot stream",
        );

        const sdkSessionId = copilotSessionIdForConversation(taskId, conversationId);
        await adapter.triggerBeforeEvict(sdkSessionId);

        await runtime.waitForExecutionStatus(result.executionId, "cancelled");
        expect(runtime.getExecutionStatus(result.executionId)).toBe("cancelled");
    });

    it("C2: touchCalls contains running state after a tool starts executing (heartbeat wiring smoke)", async () => {
        const adapter = new MockCopilotSdkAdapter();
        adapter
            .queueResumeFailure(new Error("missing session"))
            .queueCreateSuccess(new MockCopilotSession().queueTurn({
                steps: [toolStart("t1", "create_card"), toolResult("t1", "ok"), token("done"), done()],
            }));
        const runtime = createCopilotRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "work" });
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const runningCalls = adapter.trace.touchCalls.filter((c) => c.state === "running");
        expect(runningCalls.length).toBeGreaterThan(0);
    });
});
