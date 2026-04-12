/**
 * Layer 1 — Stream Pipeline Scenarios
 *
 * Tests the Orchestrator → StreamEvent conversion using ScriptedEngine.
 * Validates ordering and content of StreamEvents for all key scenarios:
 *   S-1  reasoning then text
 *   S-2  reasoning → tool → text
 *   S-3  multiple tool rounds
 *   S-4  cancel mid-reasoning
 *   S-5  subagent events via queueStreamEvents (UI-layer only; handled in chat-timeline-pipeline.test.ts)
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
} from "./support/scripted-engine.ts";
import type { StreamEvent } from "../../shared/rpc-types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function typesOf(events: StreamEvent[]): string[] {
    return events.map((e) => e.type);
}

function firstIndexOf(events: StreamEvent[], type: StreamEvent["type"]): number {
    return events.findIndex((e) => e.type === type);
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

let runtime: BackendRpcRuntime;

afterEach(() => {
    runtime?.cleanup();
});

function makeRuntime(engine: ScriptedEngine): BackendRpcRuntime {
    return createBackendRpcRuntime({ createEngine: () => engine });
}

// ─── S-1: Reasoning then text ────────────────────────────────────────────────

describe("S-1: reasoning then text", () => {
    it("emits reasoning_chunk live then reasoning persisted, then text_chunk then assistant then done", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("think A"),
            scriptReasoning("think B"),
            scriptToken("Hello "),
            scriptToken("world."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const events = runtime.recorder.streamEventsForExecution(executionId);
        const types = typesOf(events);

        // Live chunks arrive
        expect(types).toContain("reasoning_chunk");
        expect(types).toContain("text_chunk");

        // Persisted blocks arrive
        expect(types).toContain("reasoning");
        expect(types).toContain("assistant");
        expect(types).toContain("done");

        // ORDER: reasoning_chunk before reasoning, text_chunk before assistant
        expect(firstIndexOf(events, "reasoning_chunk")).toBeLessThan(firstIndexOf(events, "reasoning"));
        expect(firstIndexOf(events, "text_chunk")).toBeLessThan(firstIndexOf(events, "assistant"));

        // ORDER: live reasoning chunks arrive before live text chunks (stream order)
        expect(firstIndexOf(events, "reasoning_chunk")).toBeLessThan(firstIndexOf(events, "text_chunk"));

        // ORDER: persisted reasoning before persisted assistant (both flushed at done)
        expect(firstIndexOf(events, "reasoning")).toBeLessThan(firstIndexOf(events, "assistant"));

        // done is last
        expect(types.at(-1)).toBe("done");

        // DB: reasoning + assistant messages persisted
        const messages = runtime.getMessages(taskId);
        expect(messages.some((m) => m.type === "reasoning")).toBe(true);
        expect(messages.some((m) => m.type === "assistant")).toBe(true);
    });
});

// ─── S-2: Reasoning → tool → text ────────────────────────────────────────────

describe("S-2: reasoning → tool → text", () => {
    it("flushes reasoning before tool_call; ordering reasoning < tool_call < tool_result < assistant", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("plan: call read_file"),
            scriptToolStart("c1", "read_file", { path: "/tmp/a.txt" }),
            scriptToolResult("c1", "read_file", "file contents"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const events = runtime.recorder.streamEventsForExecution(executionId);
        const types = typesOf(events);

        // All expected types present
        expect(types).toContain("reasoning");
        expect(types).toContain("tool_call");
        expect(types).toContain("tool_result");
        expect(types).toContain("assistant");

        // Critical ordering: reasoning BEFORE tool_call (flush-before-tool)
        expect(firstIndexOf(events, "reasoning")).toBeLessThan(firstIndexOf(events, "tool_call"));
        // tool_call before tool_result
        expect(firstIndexOf(events, "tool_call")).toBeLessThan(firstIndexOf(events, "tool_result"));
        // tool_result before assistant text
        expect(firstIndexOf(events, "tool_result")).toBeLessThan(firstIndexOf(events, "assistant"));

        // done is last
        expect(types.at(-1)).toBe("done");

        // DB messages in correct order
        const messages = runtime.getMessages(taskId);
        const msgTypes = messages.map((m) => m.type).filter((t) =>
            ["reasoning", "tool_call", "tool_result", "assistant"].includes(t),
        );
        expect(msgTypes).toEqual(["reasoning", "tool_call", "tool_result", "assistant"]);
    });
});

// ─── S-3: Multiple tool rounds ────────────────────────────────────────────────

describe("S-3: multiple tool rounds", () => {
    it("interleaves text+tool+text+tool+text in correct sequence", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptToken("First. "),
            scriptToolStart("c1", "write_file", { path: "/tmp/a.txt" }),
            scriptToolResult("c1", "write_file", "ok"),
            scriptToken("Second. "),
            scriptToolStart("c2", "read_file", { path: "/tmp/b.txt" }),
            scriptToolResult("c2", "read_file", "content"),
            scriptToken("Done."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const events = runtime.recorder.streamEventsForExecution(executionId);
        const persisted = events.filter((e) =>
            ["assistant", "tool_call", "tool_result"].includes(e.type)
        );
        const persistedTypes = persisted.map((e) => e.type);

        // Expect 2 tool_call + 2 tool_result + some assistant blocks
        expect(persistedTypes.filter((t) => t === "tool_call")).toHaveLength(2);
        expect(persistedTypes.filter((t) => t === "tool_result")).toHaveLength(2);

        // Each tool_call immediately precedes its tool_result
        const tc1 = persisted.findIndex((e) => e.type === "tool_call");
        const tr1 = persisted.findIndex((e) => e.type === "tool_result");
        expect(tr1).toBe(tc1 + 1);

        expect(events.at(-1)?.type).toBe("done");
    });
});

// ─── S-4: Cancel mid-reasoning ───────────────────────────────────────────────

describe("S-4: cancel mid-reasoning", () => {
    it("persists partial reasoning on cancel and emits done", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptReasoning("step 1"),
            scriptReasoning("step 2"),
            scriptReasoning("step 3"),
            scriptWaitForAbort(), // pause until tasks.cancel is called
            scriptDone(),         // this won't be reached, but cancel path fires first
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        // Wait for at least one reasoning_chunk to confirm engine is active
        await runtime.recorder.waitForStreamDone(
            executionId,
            100,
        ).catch(() => {
            // not done yet — that's expected, engine is paused
        });

        // Trigger cancel while engine is paused on wait_for_abort
        await runtime.handlers["tasks.cancel"]({ taskId });

        // Cancel path flushes reasoning and emits done
        await runtime.recorder.waitForStreamDone(executionId, 5_000);

        // Reasoning must be persisted
        const messages = runtime.getMessages(taskId);
        expect(messages.some((m) => m.type === "reasoning")).toBe(true);
        const reasoningMsg = messages.find((m) => m.type === "reasoning");
        expect(reasoningMsg?.content).toContain("step 1");

        // done StreamEvent must be present
        const events = runtime.recorder.streamEventsForExecution(executionId);
        expect(events.some((e) => e.type === "done")).toBe(true);
    });
});

// ─── S-5: Status chunk ────────────────────────────────────────────────────────

describe("S-5: status_chunk events", () => {
    it("emits status_chunk events that are not persisted to DB", async () => {
        const engine = new ScriptedEngine();
        engine.queueTurn([
            scriptStatus("Starting Copilot engine..."),
            scriptToken("Hello."),
            scriptDone(),
        ]);

        runtime = makeRuntime(engine);
        const { taskId } = await runtime.createTask();
        const { executionId } = await runtime.handlers["tasks.sendMessage"]({ taskId, content: "go" });

        await runtime.recorder.waitForStreamDone(executionId);

        const events = runtime.recorder.streamEventsForExecution(executionId);

        // status_chunk present in stream events
        const statusEvents = events.filter((e) => e.type === "status_chunk");
        expect(statusEvents.length).toBeGreaterThan(0);
        expect(statusEvents[0].content).toBe("Starting Copilot engine...");

        // status_chunk NOT persisted to DB (ephemeral)
        const messages = runtime.getMessages(taskId);
        expect(messages.some((m) => m.type === "system")).toBe(false);
    });
});
