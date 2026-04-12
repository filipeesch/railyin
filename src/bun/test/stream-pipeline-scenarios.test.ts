/**
 * stream-pipeline-scenarios.test. Integration tests for the full stream pipeline.ts 
 *
 DB
 *
 * Two channels under test:
 *   IPC   = runtime.getIpcEvents( ALL events, delivered immediatelyexecutionId)   
 *   DB    = runtime.getDbStreamEvents( persisted types only, written after batcher flushexecId)   
 *
 * Key properties asserted:
 *   1. ALL events arrive on IPC immediately (no 500ms delay)
 *   2. Chunks (text_chunk, reasoning_chunk, status_chunk) are NOT written to DB
 *   3. Persisted types (assistant, reasoning, tool_call, etc.) ARE written to DB after flush
 *   4. tool_start triggers an immediate DB flush (no 500ms wait)
 *   5. IPC ordering is always correct (reasoning_chunk before tool_call, etc.)
 *
 * Checkpoint protocol: engine pauses at named checkpoints so we can observe
 * transient state (IPC has data, DB does not yet).
 */

import { describe, it, expect, afterEach } from "bun:test";
import { createBackendRpcRuntime, type BackendRpcRuntime } from "./support/backend-rpc-runtime.ts";
import {
    ScriptedEngine,
    scriptToken,
    scriptReasoning,
    scriptStatus,
    scriptToolStart,
    scriptToolResult,
    scriptDone,
    scriptWaitForAbort,
    scriptCheckpoint,
} from "./support/scripted-engine.ts";

// Helpers

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Suite setup

let runtime: BackendRpcRuntime;

afterEach(() => {
    runtime?.cleanup();
});

function makeRuntime(engine: ScriptedEngine): BackendRpcRuntime {
    return createBackendRpcRuntime({ createEngine: () => engine });
}

// S-1: IPC is immediate, DB is delayed

describe("S-1: reasoning_chunk arrives on IPC before DB is written", () => {
    it("IPC has reasoning_chunk at checkpoint; DB has nothing until batcher fires", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("think A"),
            scriptReasoning("think B"),
            scriptCheckpoint("after-reasoning"),
            scriptToken("Hello."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Engine has emitted reasoning events and is paused at checkpoint
        await engine.waitForCheckpoint("after-reasoning");

        // IPC: reasoning_chunks arrived immediately
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.filter((e) => e.type === "reasoning_chunk").length).toBeGreaterThan(0);

        // DB: nothing persisted yet (batcher hasn't fired)
        const dbBefore = runtime.getDbStreamEvents(executionId);
        expect(dbBefore.filter((e) => e.type === "reasoning").length).toBe(0);

        // Chunks are NEVER written to DB
        expect(dbBefore.filter((e) => e.type === "reasoning_chunk").length).toBe(0);

        // Let engine finish
        engine.proceed("after-reasoning");
        await runtime.recorder.waitForStreamDone(executionId);

        // DB: reasoning now written (flushed at done)
        const dbAfter = runtime.getDbStreamEvents(executionId);
        expect(dbAfter.filter((e) => e.type === "reasoning").length).toBe(1);
        // DB still has no chunks
        expect(dbAfter.filter((e) => e.type === "reasoning_chunk").length).toBe(0);
    });
});

// S-2: tool_start forces immediate DB flush (not 500ms wait)

describe("S-2: tool_start forces immediate DB flush of accumulated reasoning", () => {
    it("reasoning is in DB immediately after tool_start, without waiting for 500ms timer", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("planning to call read_file"),
            scriptCheckpoint("after-reasoning"),
            scriptToolStart("c1", "read_file", { path: "/tmp/a.txt" }),
            scriptCheckpoint("after-tool-start"),
            scriptToolResult("c1", "read_file", "file contents"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // At this point: reasoning emitted, engine paused
        await engine.waitForCheckpoint("after-reasoning");

        const dbAtReasoning = runtime.getDbStreamEvents(executionId);
        expect(dbAtReasoning.filter((e) => e.type === "reasoning").length).toBe(0); // not yet

        //  engine emits tool_start, which must trigger immediate flushProceed 
        const t0 = Date.now();
        engine.proceed("after-reasoning");

        // Wait for tool_start checkpoint (engine paused right after emitting tool_start)
        await engine.waitForCheckpoint("after-tool-start");
        const elapsed = Date.now() - t0;

        // IPC: tool_call already arrived (immediate)
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.some((e) => e.type === "tool_call")).toBe(true);

        // DB: reasoning flushed immediately (not waiting for 500ms timer)
        const dbAfterTool = runtime.getDbStreamEvents(executionId);
        expect(dbAfterTool.filter((e) => e.type === "reasoning").length).toBe(1);

        // timing: flush happened fast, not after 500ms wait
        expect(elapsed).toBeLessThan(400);

        // IPC ordering: reasoning_chunk appeared before tool_call
        const ipcTypes = ipc.map((e) => e.type);
        const rcIdx = ipcTypes.indexOf("reasoning_chunk");
        const tcIdx = ipcTypes.indexOf("tool_call");
        expect(rcIdx).toBeLessThan(tcIdx);

        // DB ordering: reasoning before tool_call
        const dbTypes = dbAfterTool.map((e) => e.type);
        expect(dbTypes.indexOf("reasoning")).toBeLessThan(dbTypes.indexOf("tool_call"));

        // Finish
        engine.proceed("after-tool-start");
        await runtime.recorder.waitForStreamDone(executionId);
    });
});

// S-3: All events on IPC; only persisted written to DB

describe("S-3: chunks on IPC only; persisted events on both IPC and DB", () => {
    it("text_chunk/reasoning_chunk/status_chunk are NOT in DB; assistant/reasoning ARE", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptStatus("Starting..."),
            scriptReasoning("thinking"),
            scriptToken("Hello world."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.getIpcEvents(executionId);
        const db = runtime.getDbStreamEvents(executionId);

        // IPC has all event types
        expect(ipc.some((e) => e.type === "status_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "reasoning_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "text_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "reasoning")).toBe(true);
        expect(ipc.some((e) => e.type === "assistant")).toBe(true);

        // DB has ONLY persisted  no chunkstypes 
        expect(db.some((e) => e.type === "status_chunk")).toBe(false);
        expect(db.some((e) => e.type === "reasoning_chunk")).toBe(false);
        expect(db.some((e) => e.type === "text_chunk")).toBe(false);
        expect(db.some((e) => e.type === "reasoning")).toBe(true);
        expect(db.some((e) => e.type === "assistant")).toBe(true);
    });
});

// S-4: Multiple tool rounds — IPC and DB ordering consistent

describe("S-4: multiple tool rounds — IPC and DB ordering consistent", () => {
    it("tool pairs appear in correct order on both channels", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("First. "),
            scriptToolStart("c1", "write_file"),
            scriptToolResult("c1", "write_file", "ok"),
            scriptToken("Second. "),
            scriptToolStart("c2", "read_file"),
            scriptToolResult("c2", "read_file", "content"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.getIpcEvents(executionId);
        const db = runtime.getDbStreamEvents(executionId);

        // Both channels: two tool_call + two tool_result
        expect(ipc.filter((e) => e.type === "tool_call").length).toBe(2);
        expect(ipc.filter((e) => e.type === "tool_result").length).toBe(2);
        expect(db.filter((e) => e.type === "tool_call").length).toBe(2);
        expect(db.filter((e) => e.type === "tool_result").length).toBe(2);

        // IPC ordering: first tool_call directly before first tool_result
        const ipcTypes = ipc.map((e) => e.type);
        const tc1 = ipcTypes.indexOf("tool_call");
        const tr1 = ipcTypes.indexOf("tool_result");
        expect(tr1).toBe(tc1 + 1);

        // DB ordering: same
        const dbTypes = db.map((e) => e.type);
        const dtc1 = dbTypes.indexOf("tool_call");
        const dtr1 = dbTypes.indexOf("tool_result");
        expect(dtr1).toBe(dtc1 + 1);
    });
});

// S-5: Cancel — reasoning flushed to DB, done on IPC

describe("S-5: cancel mid-reasoning flushes reasoning to DB immediately", () => {
    it("after cancel: reasoning in DB, done on IPC, no chunks in DB", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("step 1"),
            scriptReasoning("step 2"),
            scriptWaitForAbort(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait briefly for reasoning_chunks to appear on IPC
        await runtime.recorder.waitForStreamDone(executionId, 150).catch(() => {
            // expected: not done yet, engine is paused at wait_for_abort
        });

        const ipcBeforeCancel = runtime.getIpcEvents(executionId);
        expect(ipcBeforeCancel.some((e) => e.type === "reasoning_chunk")).toBe(true);

        // Cancel
        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.recorder.waitForStreamDone(executionId, 5_000);

        // IPC: done event present
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.some((e) => e.type === "done")).toBe(true);

        // DB: reasoning persisted (flushed on cancel), no chunks
        const db = runtime.getDbStreamEvents(executionId);
        expect(db.some((e) => e.type === "reasoning")).toBe(true);
        expect(db.find((e) => e.type === "reasoning")?.content).toContain("step 1");
        expect(db.some((e) => e.type === "reasoning_chunk")).toBe(false);
    });
});
