/**
 * stream-pipeline-scenarios.test.ts — Integration tests for the stream pipeline.
 *
 * Spec sources:
 *   - openspec/specs/model-reasoning/spec.md
 *   - openspec/specs/task-detail/spec.md  (reasoning + tool call sections)
 *
 * Two channels under test:
 *   IPC = runtime.getIpcEvents(executionId)   — ALL events, delivered immediately
 *   DB  = runtime.getDbStreamEvents(execId)   — persisted types only, after batcher flush
 *
 * Checkpoint protocol: engine pauses at named checkpoints so we can observe
 * transient state (IPC has data, DB does not yet).
 *
 * Scenarios (keyed to spec):
 *   S-1  [model-reasoning] Bubble expands during streaming — reasoning_chunk on IPC before done
 *   S-2  [model-reasoning] Streaming reasoning stays in timeline order before its tool_call
 *   S-3  [model-reasoning] Reasoning message saved before tool_call message (DB ordering)
 *   S-4  [model-reasoning] Reasoning message saved before assistant message (DB ordering)
 *   S-5  [model-reasoning] Multiple reasoning bubbles per execution — two independent rounds
 *   S-6  [model-reasoning] No reasoning message saved when no reasoning occurred
 *   S-7  [model-reasoning] Bubble auto-collapses when round ends — IPC done signals end
 *   S-8  [model-reasoning] Cancel mid-stream — reasoning flushed to DB, done on IPC
 *   S-9  [task-detail]     Chunks (text_chunk, reasoning_chunk) are IPC-only, never in DB
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

// ---------------------------------------------------------------------------
// S-1: [model-reasoning] Bubble expands during streaming
// Spec: "WHEN the engine begins forwarding reasoning tokens for a new round
//        THEN a new ReasoningBubble appears in the conversation timeline,
//        expanded, with a pulsing header showing 'Thinking…'"
// Pipeline assertion: reasoning_chunk events arrive on IPC immediately,
// before the round is done — the frontend can start rendering.
// ---------------------------------------------------------------------------

describe("S-1 [model-reasoning]: reasoning_chunk arrives on IPC while streaming (before done)", () => {
    it("IPC has reasoning_chunk at checkpoint before the round ends", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("think A"),
            scriptReasoning("think B"),
            scriptCheckpoint("mid-reasoning"),
            scriptToken("Hello."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await engine.waitForCheckpoint("mid-reasoning");

        // reasoning_chunk on IPC — frontend can show expanded bubble
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.filter((e) => e.type === "reasoning_chunk").length).toBeGreaterThan(0);

        // done NOT yet on IPC — bubble has not collapsed yet
        expect(ipc.some((e) => e.type === "done")).toBe(false);

        engine.proceed("mid-reasoning");
        await runtime.recorder.waitForStreamDone(executionId);
    });
});

// ---------------------------------------------------------------------------
// S-2: [model-reasoning] Streaming reasoning stays in timeline order
// Spec: "WHEN a model produces reasoning before a tool call or assistant response
//        THEN the live reasoning bubble appears in the conversation at that
//        chronological position rather than in a separate visual lane"
// Pipeline assertion: IPC ordering — reasoning_chunk arrives BEFORE tool_call.
// ---------------------------------------------------------------------------

describe("S-2 [model-reasoning]: reasoning_chunk precedes tool_call on IPC (timeline order)", () => {
    it("reasoning_chunk appears before tool_call in the IPC event sequence", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("planning to call read_file"),
            scriptToolStart("c1", "read_file", { path: "/tmp/a.txt" }),
            scriptToolResult("c1", "read_file", "file contents"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const ipcTypes = runtime.getIpcEvents(executionId).map((e) => e.type);
        const rcIdx = ipcTypes.indexOf("reasoning_chunk");
        const tcIdx = ipcTypes.indexOf("tool_call");

        expect(rcIdx).toBeGreaterThan(-1);
        expect(tcIdx).toBeGreaterThan(-1);
        expect(rcIdx).toBeLessThan(tcIdx);
    });
});

// ---------------------------------------------------------------------------
// S-3: [model-reasoning] Reasoning message saved before tool_call message
// Spec: "WHEN a model round produces reasoning tokens followed by tool calls
//        THEN a reasoning message is inserted before the first tool_call
//        message of that round in the timeline"
// Pipeline assertion: DB ordering — reasoning row precedes tool_call row.
// ---------------------------------------------------------------------------

describe("S-3 [model-reasoning]: reasoning persisted to DB before tool_call row", () => {
    it("DB event order: reasoning → tool_call → tool_result", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("I should read the file first"),
            scriptToolStart("c1", "read_file", { path: "/tmp/a.txt" }),
            scriptToolResult("c1", "read_file", "file contents"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const dbTypes = db.map((e) => e.type);

        expect(dbTypes).toContain("reasoning");
        expect(dbTypes).toContain("tool_call");

        expect(dbTypes.indexOf("reasoning")).toBeLessThan(dbTypes.indexOf("tool_call"));
    });
});

// ---------------------------------------------------------------------------
// S-4: [model-reasoning] Reasoning message saved before assistant message
// Spec: "WHEN a model round produces reasoning tokens followed by the final
//        text response (no tool calls)
//        THEN a reasoning message is inserted before the assistant message"
// Pipeline assertion: DB ordering — reasoning row precedes assistant row.
// ---------------------------------------------------------------------------

describe("S-4 [model-reasoning]: reasoning persisted to DB before assistant row (no tools)", () => {
    it("DB event order: reasoning → assistant (no tool calls in this round)", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("Let me think about the answer"),
            scriptToken("The answer is 42."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const dbTypes = db.map((e) => e.type);

        expect(dbTypes).toContain("reasoning");
        expect(dbTypes).toContain("assistant");

        expect(dbTypes.indexOf("reasoning")).toBeLessThan(dbTypes.indexOf("assistant"));
    });
});

// ---------------------------------------------------------------------------
// S-5: [model-reasoning] Multiple reasoning bubbles per execution
// Spec: "WHEN the model reasons before tool calls in round 1 and again before
//        the final response in round 3
//        THEN two independent ReasoningBubble components appear at the
//        correct positions in the timeline"
// Pipeline assertion: two separate reasoning rows in DB, each at the correct
// position relative to what follows them.
// ---------------------------------------------------------------------------

describe("S-5 [model-reasoning]: two independent reasoning rounds produce two DB reasoning rows", () => {
    it("DB has two reasoning rows, each before the event that follows them", async () => {
        const engine = new ScriptedEngine();
        // Single stream: reasoning → tool → reasoning → final (two model rounds)
        engine.queueTurn([
            scriptReasoning("round 1 thinking"),
            scriptToolStart("c1", "read_file", { path: "/a" }),
            scriptToolResult("c1", "read_file", "content A"),
            scriptReasoning("round 2 thinking"),
            scriptToken("Final answer."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const reasoningEvents = db.filter((e) => e.type === "reasoning");

        // Two independent reasoning rows
        expect(reasoningEvents.length).toBe(2);

        // Round 1 reasoning content
        expect(reasoningEvents[0].content).toContain("round 1");
        // Round 2 reasoning content
        expect(reasoningEvents[1].content).toContain("round 2");

        // DB ordering: reasoning[0] before tool_call, reasoning[1] before assistant
        const dbTypes = db.map((e) => e.type);
        const r1Idx = dbTypes.indexOf("reasoning");
        const r2Idx = dbTypes.lastIndexOf("reasoning");
        const tcIdx = dbTypes.indexOf("tool_call");
        const asIdx = dbTypes.indexOf("assistant");

        expect(r1Idx).toBeLessThan(tcIdx);
        expect(r2Idx).toBeLessThan(asIdx);
    });
});

// ---------------------------------------------------------------------------
// S-6: [model-reasoning] No reasoning message saved when no reasoning occurred
// Spec: "WHEN the model completes a round with no delta.reasoning_content tokens
//        THEN no reasoning message is appended to the conversation"
// Pipeline assertion: DB has no reasoning row.
// ---------------------------------------------------------------------------

describe("S-6 [model-reasoning]: no reasoning row in DB when engine emits no reasoning events", () => {
    it("DB has zero reasoning rows for a pure tool+text round", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("c1", "read_file"),
            scriptToolResult("c1", "read_file", "content"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        expect(db.filter((e) => e.type === "reasoning").length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// S-7: [model-reasoning] Bubble auto-collapses when round ends
// Spec: "WHEN the engine emits tool calls or a final text response, ending
//        the reasoning phase
//        THEN the active ReasoningBubble header updates to 'Thought for Xs ✓'
//        and the body collapses"
// Pipeline assertion: after done on IPC, full reasoning content is in DB
// (accumulated correctly, not truncated), and no more reasoning_chunks arrive.
// ---------------------------------------------------------------------------

describe("S-7 [model-reasoning]: after IPC done, full reasoning content is in DB (round ended)", () => {
    it("DB reasoning content equals the full accumulated reasoning text", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("part one "),
            scriptReasoning("part two "),
            scriptReasoning("part three"),
            scriptToken("Answer."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const reasoning = db.find((e) => e.type === "reasoning");

        // Full accumulated content in DB
        expect(reasoning?.content).toBe("part one part two part three");

        // IPC has done event — bubble can now collapse
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.some((e) => e.type === "done")).toBe(true);

        // No more reasoning_chunks after done (IPC sequence ends)
        const doneIdx = ipc.findIndex((e) => e.type === "done");
        const chunksAfterDone = ipc.slice(doneIdx + 1).filter((e) => e.type === "reasoning_chunk");
        expect(chunksAfterDone.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// S-8: [model-reasoning] Cancel mid-stream — reasoning flushed to DB
// Spec: (cancel-execution + model-reasoning) "reasoning message saved" even
// when execution is cancelled mid-stream
// Pipeline assertion: after cancel, reasoning is in DB; done is on IPC.
// ---------------------------------------------------------------------------

describe("S-8 [model-reasoning]: cancel mid-reasoning flushes accumulated reasoning to DB", () => {
    it("after cancel: reasoning in DB with full content; done on IPC; no chunks in DB", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("step 1 "),
            scriptReasoning("step 2"),
            scriptWaitForAbort(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait for reasoning_chunks to appear on IPC (engine is paused at wait_for_abort)
        await runtime.recorder.waitForStreamDone(executionId, 150).catch(() => {});

        const ipcBeforeCancel = runtime.getIpcEvents(executionId);
        expect(ipcBeforeCancel.some((e) => e.type === "reasoning_chunk")).toBe(true);
        expect(ipcBeforeCancel.some((e) => e.type === "done")).toBe(false);

        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.recorder.waitForStreamDone(executionId, 5_000);

        // IPC: done event present (round ended via cancel)
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.some((e) => e.type === "done")).toBe(true);

        // DB: reasoning persisted, not truncated
        const db = runtime.getDbStreamEvents(executionId);
        const reasoning = db.find((e) => e.type === "reasoning");
        expect(reasoning).toBeDefined();
        expect(reasoning?.content).toContain("step 1");
        expect(reasoning?.content).toContain("step 2");

        // DB: no raw chunks — only persisted reasoning
        expect(db.some((e) => e.type === "reasoning_chunk")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// S-9: [task-detail] Chunks are IPC-only; persisted events go to both channels
// Spec: (task-detail) "Messages loaded from DB SHALL render collapsed" —
// implies DB has reasoning+assistant but NOT ephemeral chunks.
// Pipeline assertion: text_chunk/reasoning_chunk/status_chunk absent from DB.
// ---------------------------------------------------------------------------

describe("S-9 [task-detail]: ephemeral chunks on IPC only; persisted events in both IPC and DB", () => {
    it("status_chunk/text_chunk/reasoning_chunk absent from DB; reasoning/assistant present", async () => {
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

        // IPC receives all event types (live rendering)
        expect(ipc.some((e) => e.type === "status_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "reasoning_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "text_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "reasoning")).toBe(true);
        expect(ipc.some((e) => e.type === "assistant")).toBe(true);

        // DB receives only persisted types (for page reload / history)
        expect(db.some((e) => e.type === "status_chunk")).toBe(false);
        expect(db.some((e) => e.type === "reasoning_chunk")).toBe(false);
        expect(db.some((e) => e.type === "text_chunk")).toBe(false);
        expect(db.some((e) => e.type === "reasoning")).toBe(true);
        expect(db.some((e) => e.type === "assistant")).toBe(true);
    });
});
