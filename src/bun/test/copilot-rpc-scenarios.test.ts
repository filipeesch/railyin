import { afterEach, describe, expect, it } from "bun:test";
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
    toolStart,
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
});
