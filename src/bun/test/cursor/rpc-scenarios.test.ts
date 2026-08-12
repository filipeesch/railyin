import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createCursorRpcRuntime } from "@bun/test/support/cursor-rpc-runtime.ts";
import type { BackendRpcRuntime } from "@bun/test/support/backend-rpc-runtime.ts";
import { McpRegistryPool } from "../../mcp/registry-pool.ts";
import { McpClientRegistry } from "../../mcp/registry.ts";
import { FakeMcpClient } from "../support/fake-mcp-client.ts";
import {
    MockCursorSdkAdapter,
    callTool,
    fatalError,
    reasoning,
    token,
    toolResult,
    toolStart,
    toolStartWithDisplay,
    toolResultWithStructuredData,
    waitForAbort,
} from "./mocks.ts";
import {
    runCancellationScenario,
    runFatalFailureScenario,
    runMcpDiscoveryScenario,
    runModelListingScenario,
    runMultiTurnChatScenario,
    runSingleTurnChatScenario,
    runToolFailureScenario,
    runToolSuccessScenario,
    runCursorShellToolScenario,
    runCursorEditToolScenario,
} from "@bun/test/support/shared-rpc-scenarios.ts";

const runtimes: BackendRpcRuntime[] = [];

function createRuntime(adapter: MockCursorSdkAdapter, registryPool?: McpRegistryPool): BackendRpcRuntime {
    const runtime = createCursorRpcRuntime(adapter, registryPool);
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

    it("§6.3.5a — streaming decision_request via callTool persists a decision_request_prompt", async () => {
        const q1 = {
            question: "Choose architecture",
            type: "exclusive",
            options: [
                { title: "Option A", description: "Tradeoffs" },
                { title: "Option B", description: "Alternative tradeoffs" },
            ],
        };
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [
                callTool("decision_request", q1),
                callTool("decision_request", { question: "Any constraints?", type: "freetext" }),
            ],
        });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Need architecture input" });
        await runtime.waitForExecutionStatus(result.executionId, "waiting_user");

        expect(runtime.getTaskState(taskId)).toBe("waiting_user");
        const messages = runtime.getMessages(taskId);
        expect(messages.some((m) => m.type === "decision_request_prompt")).toBe(true);
        // The terminal prompt carries BOTH buffered questions (turn-end flush).
        const prompt = messages.find((m) => m.type === "decision_request_prompt")!;
        const parsed = JSON.parse(prompt.content) as { questions: Array<{ question: string }> };
        expect(parsed.questions.map((q) => q.question)).toEqual(["Choose architecture", "Any constraints?"]);
    });

    it("§6.3.5b — sending a follow-up message after decision_request restarts as a fresh execution", async () => {
        // Cursor's engine.resume() throws by contract — HumanTurnExecutor falls
        // into its restart branch and starts a brand-new execution.
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({
                steps: [callTool("decision_request", { question: "A or B?", type: "freetext" })],
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

    it("§6.3.7c — sending a follow-up message after a failed execution starts a fresh execution that completes normally", async () => {
        const adapter = new MockCursorSdkAdapter()
            .queueTurn({
                steps: [token("partial"), fatalError("agent crashed mid-stream")],
            })
            .queueTurn({ steps: [token("Recovered after failure")] });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();

        const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Explode mid-stream" });
        await runtime.recorder.waitForError(first.executionId);
        await runtime.waitForExecutionStatus(first.executionId, "failed");
        await runtime.waitForTaskState(taskId, "failed");

        const second = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "Try again" });
        // A follow-up after a failed execution starts a brand-new execution, not a resume.
        expect(second.executionId).not.toBe(first.executionId);

        await runtime.recorder.waitForStreamDone(second.executionId);
        await runtime.waitForExecutionStatus(second.executionId, "completed");

        const tail = runtime.getMessages(taskId).slice(-2).map((m) => m.type);
        expect(tail).toEqual(["user", "assistant"]);
    });

    it("§6.3.8 — model listing via shared scenario", async () => {
        const adapter = new MockCursorSdkAdapter();
        const runtime = createRuntime(adapter);

        await runModelListingScenario(runtime);
        expect(adapter.trace.listModelsCalls).toBeGreaterThan(0);
    });

    it("§6.4.1 — shell tool with stdout extraction", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [
                toolStartWithDisplay("shell-call-1", "shell", { command: "ls -la" }, { label: "bash", subject: "ls -la", contentType: "terminal" }),
                toolResultWithStructuredData("shell-call-1", "file1\nfile2\n", { detailedResult: "file1\nfile2\n" }),
                token("done"),
            ],
        });
        const runtime = createRuntime(adapter);

        await runCursorShellToolScenario(runtime);
    });

    it("§6.4.2 — edit tool with diff parsing", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [
                toolStartWithDisplay("edit-call-1", "edit", { path: "/repo/src/foo.ts" }, { label: "edit", subject: "src/foo.ts", contentType: "file" }),
                toolResultWithStructuredData("edit-call-1", "edited", {
                    writtenFiles: [{ operation: "edit_file", path: "src/foo.ts", added: 1, removed: 1, hunks: [] }],
                }),
                token("done"),
            ],
        });
        const runtime = createRuntime(adapter);

        await runCursorEditToolScenario(runtime);
    });

    it("§6.3.9 — Cursor thinking→tool→thinking→text streams in order with reasoning preserved (no pre-r blockId)", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [
                reasoning("pre-tool reasoning"),
                toolStart("c1", "web_search", { query: "foo" }),
                reasoning("in-tool reasoning"),
                toolResult("c1", "results"),
                token("final answer"),
            ],
        });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();
        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "research" });
        await runtime.recorder.waitForStreamDone(result.executionId);
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const ipc = runtime.getIpcEvents(result.executionId);

        // Committed reasoning must NOT carry the divergent pre-r blockId.
        for (const evt of ipc) expect(evt.blockId).not.toMatch(/pre-r/);

        // Two reasoning events: pre-tool (root) and in-tool (nested under c1).
        const reasoningEvts = ipc.filter((e) => e.type === "reasoning");
        expect(reasoningEvts).toHaveLength(2);

        const preTool = reasoningEvts[0];
        const inTool = reasoningEvts[1];
        expect(preTool.parentBlockId).toBeNull();
        expect(inTool.parentBlockId).toBe("c1");

        // Pre-tool reasoning precedes the tool call; in-tool reasoning precedes its result.
        const toolCallIdx = ipc.findIndex((e) => e.type === "tool_call" && e.blockId === "c1");
        const toolResultIdx = ipc.findIndex((e) => e.type === "tool_result");
        expect(ipc.findIndex((e) => e.type === "reasoning")).toBeLessThan(toolCallIdx);
        expect(ipc.findIndex((e) => e === inTool)).toBeLessThan(toolResultIdx);

        // Persisted reasoning rows use aligned enricher blockIds (r1 / r2), not pre-r.
        const db = runtime.getDbStreamEvents(result.executionId);
        const dbReasoning = db.filter((e) => e.type === "reasoning").map((e) => e.blockId).sort();
        expect(dbReasoning).toEqual([`${result.executionId}-r1`, `${result.executionId}-r2`]);
    });

    it("§6.3.10 — a usage event persists input_tokens/output_tokens on the execution", async () => {
        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [
                { kind: "emit", event: { type: "usage", inputTokens: 1000, outputTokens: 50 } },
                token("done"),
            ],
        });
        const runtime = createRuntime(adapter);
        const { taskId } = await runtime.createTask();
        const result = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(result.executionId);
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        const row = runtime.db
            .query<{ input_tokens: number | null; output_tokens: number | null }, [number]>(
                "SELECT input_tokens, output_tokens FROM executions WHERE id = ?",
            )
            .get(result.executionId);
        expect(row?.input_tokens).toBe(1000);
        expect(row?.output_tokens).toBe(50);
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

describe("Cursor — MCP discovery tools (dynamic-mcp-discovery)", () => {
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

        const adapter = new MockCursorSdkAdapter().queueTurn({
            steps: [
                callTool("list_mcp_servers", {}),
                callTool("list_mcp_tools", { server: "alpha" }),
                callTool("invoke_mcp_tool", { server: "alpha", tool: "echo", arguments: {} }),
            ],
        });
        const runtime = createRuntime(adapter, registryPool);

        await runMcpDiscoveryScenario(runtime);
    });
});
