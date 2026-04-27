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
 *   S-10 [file-diff]       file_diff is emitted only from structured writtenFiles payloads
 *   S-11 [file-diff]       Cancel/retry nested tool calls keep file_diff parent association per execution
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
    scriptToolResultWithOptions,
    scriptDone,
    scriptWaitForAbort,
    scriptCheckpoint,
} from "./support/scripted-engine.ts";
import { ClaudeEngine } from "../engine/claude/engine.ts";
import type { ClaudeSdkAdapter, ClaudeRunConfig, ClaudeSdkModelInfo } from "../engine/claude/adapter.ts";
import type { EngineEvent } from "../engine/types.ts";

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
        const { taskId, conversationId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const dbTypes = db.map((e) => e.type);

        expect(db.every((event) => event.conversationId === conversationId)).toBe(true);
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

// ---------------------------------------------------------------------------
// S-10: [file-diff] structured-only file change emission
// Validation target: file_diff emission is driven exclusively by structured
// writtenFiles; legacy inference paths are disabled.
// ---------------------------------------------------------------------------

describe("S-10 [file-diff]: file_diff emission is structured-only", () => {
    it("ignores legacy-style tool results when writtenFiles is absent", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("c-structured", "create", { path: "src/new.ts", file_text: "export const n = 1;" }),
            scriptToolResultWithOptions("c-structured", "create", "created", {
                writtenFiles: [{
                    operation: "write_file",
                    path: "src/new.ts",
                    added: 1,
                    removed: 0,
                    is_new: true,
                }],
            }),
            scriptToolStart("c-legacy", "edit", { path: "src/legacy.ts" }),
            scriptToolResult(
                "c-legacy",
                "edit",
                "--- a/src/legacy.ts\n+++ b/src/legacy.ts\n@@ -1 +1 @@\n-old\n+new",
            ),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "mix history" });

        await runtime.recorder.waitForStreamDone(executionId);

        const db = runtime.getDbStreamEvents(executionId);
        const fileDiffs = db.filter((e) => e.type === "file_diff");

        expect(fileDiffs).toHaveLength(1);

        const structured = JSON.parse(fileDiffs[0]!.content) as { operation: string; path: string; added: number; removed: number };

        expect(structured).toEqual({ operation: "write_file", path: "src/new.ts", added: 1, removed: 0, is_new: true });
    });
});

// ---------------------------------------------------------------------------
// S-11: [file-diff] Cancel/retry + nested tool calls preserve association
// Validation target (task 6.3): nested call file_diff events remain linked to
// their child tool call block in each execution and do not cross-contaminate
// after cancellation and retry.
// ---------------------------------------------------------------------------

describe("S-11 [file-diff]: cancel/retry preserves nested file_diff parent association", () => {
    it("emits nested file_diff with parentBlockId set to child call ID in both cancelled and retried runs", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToolStart("parent-call", "spawn_agent", { prompt: "first" }),
            scriptToolStart("child-call", "edit_file", { path: "src/child-a.ts" }, { parentCallId: "parent-call" }),
            scriptToolResultWithOptions("child-call", "edit_file", "updated child a", {
                writtenFiles: [{
                    operation: "patch_file",
                    path: "src/child-a.ts",
                    added: 2,
                    removed: 1,
                }],
            }),
            scriptWaitForAbort(),
        ]);
        engine.queueTurn([
            scriptToolStart("parent-call-2", "spawn_agent", { prompt: "retry" }),
            scriptToolStart("child-call-2", "edit_file", { path: "src/child-b.ts" }, { parentCallId: "parent-call-2" }),
            scriptToolResultWithOptions("child-call-2", "edit_file", "updated child b", {
                writtenFiles: [{
                    operation: "patch_file",
                    path: "src/child-b.ts",
                    added: 3,
                    removed: 0,
                }],
            }),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();

        const first = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "run 1" });
        await sleep(100);
        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.recorder.waitForStreamDone(first.executionId, 5_000);

        const second = await runtime.handlers["tasks.retry"]({ taskId });
        await runtime.recorder.waitForStreamDone(second.executionId);

        expect(second.executionId).not.toBe(first.executionId);

        const firstIpcDiff = runtime.getIpcEvents(first.executionId).find((e) => e.type === "file_diff");
        const secondIpcDiff = runtime.getIpcEvents(second.executionId).find((e) => e.type === "file_diff");

        expect(firstIpcDiff?.parentBlockId).toBe("child-call");
        expect(secondIpcDiff?.parentBlockId).toBe("child-call-2");

        const firstIpcPayload = firstIpcDiff ? JSON.parse(firstIpcDiff.content) as { path: string } : null;
        const secondIpcPayload = secondIpcDiff ? JSON.parse(secondIpcDiff.content) as { path: string } : null;
        expect(firstIpcPayload?.path).toBe("src/child-a.ts");
        expect(secondIpcPayload?.path).toBe("src/child-b.ts");

        const firstDbDiffs = runtime.getDbStreamEvents(first.executionId).filter((e) => e.type === "file_diff");
        const secondDbDiffs = runtime.getDbStreamEvents(second.executionId).filter((e) => e.type === "file_diff");

        expect(firstDbDiffs.at(0)?.parentBlockId).toBe("child-call");
        if (secondDbDiffs.length > 0) {
            expect(secondDbDiffs.every((event) => event.parentBlockId === "child-call-2")).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// S-12: Cancel stops streaming — no text_chunk events after done in IPC
// Validates that the cancel abort signal propagates through the orchestrator
// and prevents post-cancel events from being broadcast.
// ---------------------------------------------------------------------------

describe("S-12: Cancel stops streaming — no text_chunk events after done", () => {
    it("text_chunk emitted before cancel; nothing after done", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("before"),
            scriptWaitForAbort(),
            scriptToken("after-abort"),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait for "before" token to appear on IPC
        await runtime.recorder.waitUntilIpc(executionId, (evs) =>
            evs.some((e) => e.type === "text_chunk" && e.content === "before"),
        );

        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.recorder.waitForStreamDone(executionId, 5_000);

        const ipc = runtime.getIpcEvents(executionId);
        // "before" must be present
        expect(ipc.some((e) => e.type === "text_chunk" && e.content === "before")).toBe(true);
        // "after-abort" must NOT appear — discarded by the abort check in consumeStream
        expect(ipc.some((e) => e.type === "text_chunk" && e.content === "after-abort")).toBe(false);
        // done must be present
        expect(ipc.some((e) => e.type === "done")).toBe(true);
        // No text_chunk should appear after the done event
        const doneIndex = ipc.findIndex((e) => e.type === "done");
        const eventsAfterDone = ipc.slice(doneIndex + 1).filter((e) => e.type === "text_chunk");
        expect(eventsAfterDone).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// S-13: Cancel transitions task to waiting_user; execution marked cancelled
// Validates the full state machine: running → waiting_user on cancel.
// ---------------------------------------------------------------------------

describe("S-13: Cancel transitions task to waiting_user", () => {
    it("task execution_state is waiting_user after cancel; done on IPC", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("streaming"),
            scriptWaitForAbort(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait for at least one token before cancelling
        await runtime.recorder.waitUntilIpc(executionId, (evs) =>
            evs.some((e) => e.type === "text_chunk"),
        );

        await runtime.handlers["tasks.cancel"]({ taskId });
        await runtime.recorder.waitForStreamDone(executionId, 5_000);

        // Task must transition to waiting_user
        await runtime.waitForTaskState(taskId, "waiting_user");
        const cancelledUpdates = runtime.recorder.taskUpdates.filter(
            (t) => t.id === taskId && t.executionState === "waiting_user",
        );
        expect(cancelledUpdates.length).toBeGreaterThan(0);

        // IPC must have done event
        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.some((e) => e.type === "done")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// MockClaudeSdkAdapter — yields pre-canned EngineEvents for integration tests
// ---------------------------------------------------------------------------

class MockClaudeSdkAdapter implements ClaudeSdkAdapter {
    constructor(private readonly events: EngineEvent[]) {}

    async *run(_config: ClaudeRunConfig): AsyncGenerator<EngineEvent> {
        for (const event of this.events) {
            yield event;
        }
    }

    async cancel(_executionId: number): Promise<void> {}

    async listModels(_workingDirectory: string): Promise<ClaudeSdkModelInfo[]> {
        return [];
    }

    async listCommands(_workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
        return [];
    }
}

function makeClaudeRuntime(sdkAdapter: ClaudeSdkAdapter): BackendRpcRuntime {
    return createBackendRpcRuntime({
        createEngine: () => new ClaudeEngine(undefined, () => {}, () => {}, sdkAdapter),
    });
}

// ---------------------------------------------------------------------------
// S-14: [stream_event handling] CE-1 — token events flow through to text_chunk IPC
// Spec: "WHEN the Claude SDK emits incremental token events
//        THEN text_chunk IPC events appear in order before the done event"
// Pipeline assertion: pre-canned token/reasoning events propagate end-to-end.
// ---------------------------------------------------------------------------

describe("S-14 [stream_event]: token events from ClaudeEngine flow through to text_chunk on IPC", () => {
    it("text_chunk events arrive in order on IPC for each token yielded by adapter", async () => {
        const adapter = new MockClaudeSdkAdapter([
            { type: "token", content: "Hello " },
            { type: "token", content: "world" },
            { type: "done" },
        ]);

        runtime = makeClaudeRuntime(adapter);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.getIpcEvents(executionId);
        const textChunks = ipc.filter((e) => e.type === "text_chunk");

        expect(textChunks).toHaveLength(2);
        expect(textChunks[0]).toMatchObject({ type: "text_chunk", content: "Hello " });
        expect(textChunks[1]).toMatchObject({ type: "text_chunk", content: "world" });

        // done must arrive after all text_chunks
        const doneIndex = ipc.findIndex((e) => e.type === "done");
        const lastChunkIndex = ipc.findLastIndex((e) => e.type === "text_chunk");
        expect(doneIndex).toBeGreaterThan(lastChunkIndex);
    });

    it("reasoning_chunk events arrive on IPC for each reasoning event yielded by adapter", async () => {
        const adapter = new MockClaudeSdkAdapter([
            { type: "reasoning", content: "Let me think" },
            { type: "token", content: "Result" },
            { type: "done" },
        ]);

        runtime = makeClaudeRuntime(adapter);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const ipc = runtime.getIpcEvents(executionId);
        expect(ipc.some((e) => e.type === "reasoning_chunk")).toBe(true);
        expect(ipc.some((e) => e.type === "text_chunk")).toBe(true);

        // reasoning_chunk must precede text_chunk (timeline order)
        const rcIdx = ipc.findIndex((e) => e.type === "reasoning_chunk");
        const tcIdx = ipc.findIndex((e) => e.type === "text_chunk");
        expect(rcIdx).toBeLessThan(tcIdx);
    });
});
