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

        // 07-01 contract: the decision_request interrupt persists via the
        // interrupt registry, NOT conversation_messages (zero writes).
        expect(runtime.getTaskState(taskId)).toBe("waiting_user");
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

        await runtime.waitForExecutionStatus(second.executionId, "completed");
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

        await runtime.waitForExecutionStatus(second.executionId, "completed");
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
                    detailedResult: "diff --git a/src/foo.ts b/src/foo.ts\n@@ -1,2 +1,2 @@\n-old\n+new",
                }),
                token("done"),
            ],
        });
        const runtime = createRuntime(adapter);

        await runCursorEditToolScenario(runtime);
    });
});

describe("Cursor slash-command resolution", () => {
    it("resolves slash prompt via dialect before sending to adapter", async () => {
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
        await runtime.waitForExecutionStatus(result.executionId, "completed");

        // The adapter received the resolved XML body, not the raw slash chip
        // (the raw chip is no longer persisted to conversation_messages — 07-01).
        const sentPrompt = adapter.trace.runConfigs[0]!.prompt;
        expect(sentPrompt).toContain('<command name="opsx-propose"');
        expect(sentPrompt).toContain("Resolved body: add-dark-mode");
        expect(sentPrompt).not.toContain("[/opsx-propose|/opsx-propose]");
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
