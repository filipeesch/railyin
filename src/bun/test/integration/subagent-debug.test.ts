/**
 * Debug harness for subagent bubble rendering.
 * Adds verbose logging to trace the full event pipeline.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ScriptedEngine, scriptToolStart, scriptToolResult, scriptDone } from "../support/scripted-engine.ts";
import { createBackendRpcRuntime } from "../support/backend-rpc-runtime.ts";

function makeRuntime(engine: ScriptedEngine) {
    return createBackendRpcRuntime({
        createEngine: () => engine,
    });
}

describe("Subagent bubble debug", () => {
    it("DEBUG-1: log all IPC events for single subagent", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("tc-1", "web_search", { prompt: "test query" }),
            { type: "subagent_start", callId: "sa-1", intent: "web-search-123", prompt: "test query" },
            { type: "subagent_stop", callId: "sa-1", result: "## Answer\nFound it." },
            scriptToolResult("tc-1", "web_search", "## Answer\nFound it."),
            scriptDone(),
        ]);

        const runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        console.log("\n=== IPC EVENTS ===");
        const ipc = runtime.recorder.streamEventsForExecution(executionId);
        ipc.forEach((e, i) => {
            console.log(`[${i}] type=${e.type}, blockId=${e.blockId}, subagentId=${e.subagentId}, done=${e.done}, parentBlockId=${e.parentBlockId}, content=${e.content?.slice(0, 80)}...`);
        });
        console.log(`\nTotal IPC events: ${ipc.length}`);

        // Verify subagent events
        const subagentCall = ipc.find((e) => e.type === "tool_call" && e.subagentId === "sa-1");
        const subagentResult = ipc.find((e) => e.type === "tool_result" && e.subagentId === "sa-1");
        console.log(`\nsubagentCall found: ${!!subagentCall}, blockId=${subagentCall?.blockId}, done=${subagentCall?.done}`);
        console.log(`subagentResult found: ${!!subagentResult}, blockId=${subagentResult?.blockId}, done=${subagentResult?.done}`);

        // Verify DB persistence
        const dbEvents = runtime.getDbStreamEvents(executionId);
        console.log("\n=== DB EVENTS ===");
        dbEvents.forEach((e, i) => {
            console.log(`[${i}] type=${e.type}, blockId=${e.blockId}, subagentId=${e.subagentId}`);
        });
        console.log(`Total DB events: ${dbEvents.length}`);

        // Verify messages
        console.log("\n=== MESSAGES ===");
        const messages = runtime.getMessages(taskId);
        messages.forEach((m, i) => {
            console.log(`[${i}] type=${m.type}, content=${m.content?.slice(0, 80)}...`);
        });
        console.log(`Total messages: ${messages.length}`);

        expect(subagentCall).toBeDefined();
        expect(subagentResult).toBeDefined();
    });

    it("DEBUG-2: log all IPC events for multiple subagents", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("tc-1", "web_search", { prompt: "query A" }),
            scriptToolStart("tc-2", "web_search", { prompt: "query B" }),
            { type: "subagent_start", callId: "sa-1", intent: "web-search-1", prompt: "query A" },
            { type: "subagent_start", callId: "sa-2", intent: "web-search-2", prompt: "query B" },
            { type: "subagent_stop", callId: "sa-1", result: "## Answer\nResult A." },
            { type: "subagent_stop", callId: "sa-2", result: "## Answer\nResult B." },
            scriptToolResult("tc-1", "web_search", "## Answer\nResult A."),
            scriptToolResult("tc-2", "web_search", "## Answer\nResult B."),
            scriptDone(),
        ]);

        const runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });
        await runtime.recorder.waitForStreamDone(executionId);

        console.log("\n=== MULTI-AGENT IPC EVENTS ===");
        const ipc = runtime.recorder.streamEventsForExecution(executionId);
        ipc.forEach((e, i) => {
            console.log(`[${i}] type=${e.type}, blockId=${e.blockId}, subagentId=${e.subagentId}, done=${e.done}`);
        });

        for (const id of ["sa-1", "sa-2"]) {
            const call = ipc.find((e) => e.type === "tool_call" && e.subagentId === id);
            const result = ipc.find((e) => e.type === "tool_result" && e.subagentId === id);
            console.log(`\n${id}: call=${!!call}, result=${!!result}`);
        }

        expect(ipc.filter((e) => e.subagentId === "sa-1").length).toBeGreaterThanOrEqual(2);
        expect(ipc.filter((e) => e.subagentId === "sa-2").length).toBeGreaterThanOrEqual(2);
    });
});
