/**
 * Integration test for subagent bubble rendering.
 *
 * Reproduces the bug where a single web_search agent's subagent bubble
 * doesn't appear in the UI, but multiple parallel agents do.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ScriptedEngine, scriptToolStart, scriptToolResult, scriptDone } from "../support/scripted-engine.ts";
import { createBackendRpcRuntime } from "../support/backend-rpc-runtime.ts";
import type { EngineEvent } from "../../engine/types.ts";

function makeRuntime(engine: ScriptedEngine) {
    return createBackendRpcRuntime({
        createEngine: () => engine,
    });
}

describe("Subagent bubble rendering", () => {
    let runtime: ReturnType<typeof makeRuntime>;

    it("SA-1: single subagent bubble appears in IPC events", async () => {
        // Single web_search agent: tool_start → subagent_start → subagent_stop → tool_result → done
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("tc-1", "web_search", { prompt: "test query" }),
            { type: "subagent_start", callId: "sa-1", intent: "web-search-123", prompt: "test query" },
            // Child agent tools (internal, nested under subagent bubble)
            { type: "tool_start", name: "browser_search", callId: "child-1", arguments: JSON.stringify({ query: "test" }), parentCallId: "sa-1", isInternal: true },
            { type: "tool_result", name: "browser_search", callId: "child-1", result: "results", parentCallId: "sa-1", isInternal: true },
            { type: "subagent_stop", callId: "sa-1", result: "## Answer\nFound it.\n\n## Sources\n- [Example](https://example.com)" },
            scriptToolResult("tc-1", "web_search", "## Answer\nFound it.\n\n## Sources\n- [Example](https://example.com)"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.recorder.streamEventsForExecution(executionId);

        // 1. web_search tool_call should appear
        const webSearchCall = ipc.find((e) => e.type === "tool_call" && e.content.includes('"name":"web_search"'));
        expect(webSearchCall).toBeDefined();
        expect(webSearchCall?.done).toBe(false);

        // 2. subagent bubble tool_call should appear (function name "subagent")
        const subagentCall = ipc.find((e) => e.type === "tool_call" && e.blockId === "sa-1" && e.subagentId === "sa-1");
        expect(subagentCall).toBeDefined();
        expect(subagentCall?.content).toContain('"name":"subagent"');
        expect(subagentCall?.done).toBe(false);

        // 3. subagent_stop should produce a tool_result with done=true and matching blockId
        const subagentResult = ipc.find((e) => e.type === "tool_result" && e.blockId === "sa-1" && e.done === true && e.subagentId === "sa-1");
        expect(subagentResult).toBeDefined();
        expect(subagentResult?.content).toContain("Found it");

        // 4. web_search tool_result should appear
        const allResults = ipc.filter((e) => e.type === "tool_result");
        const webSearchResult = allResults.find((e) => e.blockId === "tc-1");
        expect(webSearchResult).toBeDefined();

        // 5. Verify the event sequence: subagent_start → subagent_stop → web_search tool_result
        const startIdx = ipc.indexOf(subagentCall!);
        const stopIdx = ipc.indexOf(subagentResult!);
        expect(stopIdx).toBeGreaterThan(startIdx);
        const wsResultIdx = ipc.indexOf(webSearchResult!);
        expect(wsResultIdx).toBeGreaterThan(stopIdx);
    });

    it("SA-2: child internal tool calls are nested under subagent bubble", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("tc-1", "web_search", { prompt: "test query" }),
            { type: "subagent_start", callId: "sa-1", intent: "web-search-123", prompt: "test query" },
            // Child agent tool calls
            { type: "tool_start", name: "browser_search", callId: "child-1", arguments: JSON.stringify({ query: "test" }), parentCallId: "sa-1", isInternal: true },
            { type: "tool_result", name: "browser_search", callId: "child-1", result: "results", parentCallId: "sa-1", isInternal: true },
            { type: "subagent_stop", callId: "sa-1", result: "## Answer\nFound it." },
            scriptToolResult("tc-1", "web_search", "## Answer\nFound it."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.recorder.streamEventsForExecution(executionId);

        // Child tool calls should have parentBlockId set to the subagent bubble
        const childToolCall = ipc.find((e) => e.type === "tool_call" && e.parentBlockId === "sa-1");
        expect(childToolCall).toBeDefined();

        const childToolResult = ipc.find((e) => e.type === "tool_result" && e.parentBlockId === "sa-1");
        expect(childToolResult).toBeDefined();
    });

    it("SA-3: multiple parallel subagent bubbles all appear", async () => {
        // Three parallel web_search agents
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("tc-1", "web_search", { prompt: "query A" }),
            scriptToolStart("tc-2", "web_search", { prompt: "query B" }),
            scriptToolStart("tc-3", "web_search", { prompt: "query C" }),
            { type: "subagent_start", callId: "sa-1", intent: "web-search-1", prompt: "query A" },
            { type: "subagent_start", callId: "sa-2", intent: "web-search-2", prompt: "query B" },
            { type: "subagent_start", callId: "sa-3", intent: "web-search-3", prompt: "query C" },
            { type: "subagent_stop", callId: "sa-1", result: "## Answer\nResult A." },
            { type: "subagent_stop", callId: "sa-2", result: "## Answer\nResult B." },
            { type: "subagent_stop", callId: "sa-3", result: "## Answer\nResult C." },
            scriptToolResult("tc-1", "web_search", "## Answer\nResult A."),
            scriptToolResult("tc-2", "web_search", "## Answer\nResult B."),
            scriptToolResult("tc-3", "web_search", "## Answer\nResult C."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.recorder.streamEventsForExecution(executionId);

        // All three subagent bubbles should appear
        for (const id of ["sa-1", "sa-2", "sa-3"]) {
            const subagentCall = ipc.find((e) => e.type === "tool_call" && e.blockId === id && e.subagentId === id);
            expect(subagentCall).toBeDefined();

            const subagentResult = ipc.find((e) => e.type === "tool_result" && e.blockId === id && e.done === true && e.subagentId === id);
            expect(subagentResult).toBeDefined();
        }
    });

    it("SA-4: subagent bubble persisted to DB as tool_call message", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("tc-1", "web_search", { prompt: "test query" }),
            { type: "subagent_start", callId: "sa-1", intent: "web-search-123", prompt: "test query" },
            { type: "subagent_stop", callId: "sa-1", result: "## Answer\nFound it." },
            scriptToolResult("tc-1", "web_search", "## Answer\nFound it."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        const dbEvents = runtime.getDbStreamEvents(executionId);

        // subagent_start should be persisted as tool_call with subagentId
        const subagentCallDb = dbEvents.find((e) => e.type === "tool_call" && e.subagentId === "sa-1");
        expect(subagentCallDb).toBeDefined();

        // subagent_stop produces a tool_result IPC event (not a separate DB row — the conversation store
        // updates the existing tool_call block's done status and metadata)
        const ipc = runtime.recorder.streamEventsForExecution(executionId);
        const subagentResultIpc = ipc.find((e) => e.type === "tool_result" && e.subagentId === "sa-1" && e.done === true);
        expect(subagentResultIpc).toBeDefined();
    });
});
