/**
 * mock-agui.test.ts — unit tests for the MockAgui connect replay builder
 * (plan 05-01). Pure node tests: no @playwright/test imports — the builder
 * is a framework-free pure function, and registerThread only touches the
 * fixture-side registry (no Page needed).
 *
 * The replay shape under test (RUNR-05 / RUNR-06):
 *   registered thread  → RUN_STARTED + quick event sequence + MESSAGES_SNAPSHOT
 *                        + RUN_FINISHED (single terminal, wire-valid order:
 *                        the client's verifyEvents rejects any event after
 *                        RUN_FINISHED, so the snapshot sits before it)
 *   never-run thread   → empty SSE body (RUNR-06)
 */
import { describe, test, expect } from "bun:test";
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { MockAgui, buildConnectReplaySseBody, buildErrorRunSseBody, buildToolCallRunSseBody, buildReasoningRunSseBody, buildInterruptRunSseBody, buildSlowRunSseBody } from "./mock-agui";

/** Decode an EventEncoder-framed SSE body into its JSON event frames. */
function decodeFrames(sseBody: string): AGUIEvent[] {
    if (sseBody === "") return [];
    return sseBody
        .split("\n\n")
        .filter((frame) => frame.trim() !== "")
        .map((frame) => JSON.parse(frame.replace(/^data: /, "")));
}

/** Event-type sequence of a decoded body. */
function typesOf(sseBody: string): EventType[] {
    return decodeFrames(sseBody).map((frame) => frame.type as EventType);
}

describe("buildConnectReplaySseBody", () => {
    test("registered thread: replay body decodes to valid AGUIEvent JSON frames", () => {
        MockAgui.prototype.registerThread("t-valid");
        const body = buildConnectReplaySseBody("t-valid");

        const frames = decodeFrames(body);
        expect(frames.length).toBeGreaterThan(0);

        // Every frame parses and carries a known event type.
        const knownTypes = new Set<string>(Object.values(EventType));
        for (const frame of frames) {
            expect(typeof frame).toBe("object");
            expect(knownTypes.has(frame.type as string)).toBe(true);
        }
    });

    test("registered thread: canonical sequence RUN_STARTED → MESSAGES_SNAPSHOT → RUN_FINISHED in order", () => {
        MockAgui.prototype.registerThread("t-seq");
        const types = typesOf(buildConnectReplaySseBody("t-seq"));

        expect(types[0]).toBe(EventType.RUN_STARTED);
        const snapshotIdx = types.indexOf(EventType.MESSAGES_SNAPSHOT);
        const finishedIdx = types.lastIndexOf(EventType.RUN_FINISHED);
        expect(snapshotIdx).toBeGreaterThan(0);
        expect(finishedIdx).toBeGreaterThan(snapshotIdx);
        // Single terminal: the last frame is RUN_FINISHED.
        expect(finishedIdx).toBe(types.length - 1);
        // The historic quick text events are replayed (never-run history absent).
        expect(types).toContain(EventType.TEXT_MESSAGE_START);
        expect(types).toContain(EventType.TEXT_MESSAGE_END);
    });

    test("MESSAGES_SNAPSHOT payload references the replayed 'hello' message", () => {
        MockAgui.prototype.registerThread("t-msg");
        const frames = decodeFrames(buildConnectReplaySseBody("t-msg"));

        const snapshot = frames.find((f) => f.type === EventType.MESSAGES_SNAPSHOT) as
            | { type: EventType.MESSAGES_SNAPSHOT; messages: Array<{ id: string; role: string; content?: string }> }
            | undefined;
        expect(snapshot).toBeDefined();
        expect(snapshot!.messages).toEqual([{ id: "m1", role: "assistant", content: "hello" }]);
    });

    test("never-run thread: unknown threadId yields an empty SSE body (RUNR-06)", () => {
        expect(buildConnectReplaySseBody("t-never-run")).toBe("");
    });

    test("registerThread flips the empty → replay path for the same threadId", () => {
        // Not registered yet — never-run semantics.
        expect(buildConnectReplaySseBody("t-flip")).toBe("");
        MockAgui.prototype.registerThread("t-flip");
        expect(buildConnectReplaySseBody("t-flip")).not.toBe("");
    });
});

describe("buildErrorRunSseBody", () => {
    // RunAgentInputSchema requires messages/tools/context arrays (05-01
    // deviation: minimal inputs fail parse) — shared minimal valid input.
    const validInput = { threadId: "t-err", runId: "r-err", messages: [], tools: [], context: [] };

    test("sequence is RUN_STARTED → text events → terminal RUN_ERROR", () => {
        const types = typesOf(buildErrorRunSseBody(validInput));

        expect(types[0]).toBe(EventType.RUN_STARTED);
        expect(types).toContain(EventType.TEXT_MESSAGE_START);
        expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
        expect(types).toContain(EventType.TEXT_MESSAGE_END);
        // RUN_ERROR is the terminal frame — the client's verifyEvents rejects
        // any event after it, so nothing may follow.
        expect(types[types.length - 1]).toBe(EventType.RUN_ERROR);
        expect(types).not.toContain(EventType.RUN_FINISHED);
    });

    test("RUN_ERROR frame carries the 'simulated failure' message", () => {
        const frames = decodeFrames(buildErrorRunSseBody(validInput));
        const errorFrame = frames[frames.length - 1] as {
            type: EventType.RUN_ERROR;
            message: string;
        };
        expect(errorFrame.type).toBe(EventType.RUN_ERROR);
        expect(errorFrame.message).toBe("simulated failure");
    });

    test("RUN_STARTED carries the parsed request input (runner patch parity)", () => {
        const frames = decodeFrames(
            buildErrorRunSseBody({ ...validInput, threadId: "t-err-in" }),
        );
        const started = frames[0] as { type: EventType.RUN_STARTED; input?: unknown };
        expect(started.input).toBeDefined();
        expect((started.input as { threadId?: string }).threadId).toBe("t-err-in");
    });
});

describe("buildToolCallRunSseBody (plan 05-04)", () => {
    const validInput = { threadId: "t-tc", runId: "r-tc", messages: [], tools: [], context: [] };

    test("covers the generic tool + all three domain families, terminal RUN_FINISHED last", () => {
        const frames = decodeFrames(buildToolCallRunSseBody(validInput));
        const types = frames.map((f) => f.type);

        expect(types[0]).toBe(EventType.RUN_STARTED);
        const starts = frames.filter((f) => f.type === EventType.TOOL_CALL_START) as Array<{ toolCallName?: string }>;
        expect(starts.map((s) => s.toolCallName)).toEqual(["create_card", "bash", "subagent", "write_file"]);
        expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
        expect(types).not.toContain(EventType.RUN_ERROR);
    });

    test("TOOL_CALL_RESULT frames carry the canonical bridge shape (messageId + role 'tool')", () => {
        const frames = decodeFrames(buildToolCallRunSseBody(validInput));
        const results = frames.filter((f) => f.type === EventType.TOOL_CALL_RESULT) as Array<{
            toolCallId: string;
            messageId: string;
            role?: string;
            content: string;
        }>;
        expect(results.length).toBe(4);
        for (const r of results) {
            expect(r.messageId).toBe(`${r.toolCallId}-result`);
            expect(r.role).toBe("tool");
            expect(typeof r.content).toBe("string");
        }
    });

    test("tool calls sequence START → ARGS → END → RESULT per call (verifyEvents order)", () => {
        const frames = decodeFrames(buildToolCallRunSseBody(validInput));
        const ids = ["tc-card", "tc-bash", "tc-sub", "tc-write"];
        for (const id of ids) {
            const idx = frames.findIndex((f) => f.type === EventType.TOOL_CALL_START && (f as { toolCallId?: string }).toolCallId === id);
            const argsIdx = frames.findIndex((f) => f.type === EventType.TOOL_CALL_ARGS && (f as { toolCallId?: string }).toolCallId === id);
            const endIdx = frames.findIndex((f) => f.type === EventType.TOOL_CALL_END && (f as { toolCallId?: string }).toolCallId === id);
            const resIdx = frames.findIndex((f) => f.type === EventType.TOOL_CALL_RESULT && (f as { toolCallId?: string }).toolCallId === id);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(argsIdx).toBeGreaterThan(idx);
            expect(endIdx).toBeGreaterThan(argsIdx);
            expect(resIdx).toBeGreaterThan(endIdx);
        }
    });
});

describe("buildReasoningRunSseBody (plan 05-04)", () => {
    const validInput = { threadId: "t-re", runId: "r-re", messages: [], tools: [], context: [] };

    test("sequence: RUN_STARTED → reasoning events (role 'reasoning') → text → RUN_FINISHED", () => {
        const frames = decodeFrames(buildReasoningRunSseBody(validInput));
        const types = frames.map((f) => f.type);

        expect(types[0]).toBe(EventType.RUN_STARTED);
        const startIdx = types.indexOf(EventType.REASONING_MESSAGE_START);
        const contentIdx = types.indexOf(EventType.REASONING_MESSAGE_CONTENT);
        const endIdx = types.indexOf(EventType.REASONING_MESSAGE_END);
        expect(startIdx).toBeGreaterThan(0);
        expect(contentIdx).toBeGreaterThan(startIdx);
        expect(endIdx).toBeGreaterThan(contentIdx);
        expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    });

    test("reasoning start frame carries role 'reasoning' (bridge parity)", () => {
        const frames = decodeFrames(buildReasoningRunSseBody(validInput));
        const start = frames.find((f) => f.type === EventType.REASONING_MESSAGE_START) as { role?: string; messageId?: string };
        expect(start.role).toBe("reasoning");
        expect(start.messageId).toBe("r1");
    });
});

describe("buildInterruptRunSseBody (plan 05-04)", () => {
    const validInput = { threadId: "t-in", runId: "r-in", messages: [], tools: [], context: [] };

    test("terminal RUN_FINISHED carries the interrupt outcome with 2-question metadata", () => {
        const frames = decodeFrames(buildInterruptRunSseBody(validInput));
        const terminal = frames[frames.length - 1] as {
            type: EventType.RUN_FINISHED;
            outcome?: { type: string; interrupts: Array<{ id: string; reason: string; metadata?: { questions?: unknown[] } }> };
        };
        expect(terminal.type).toBe(EventType.RUN_FINISHED);
        expect(terminal.outcome?.type).toBe("interrupt");
        expect(terminal.outcome?.interrupts.length).toBe(1);
        const interrupt = terminal.outcome!.interrupts[0];
        expect(interrupt.id).toBe("decision-interrupt-1");
        expect(interrupt.reason).toBe("decision_request");
        expect(interrupt.metadata?.questions?.length).toBe(2);
    });
});

describe("buildSlowRunSseBody (plan 05-04)", () => {
    const validInput = { threadId: "t-sl", runId: "r-sl", messages: [], tools: [], context: [] };

    test("text chunks with NO terminal — the run never self-completes", () => {
        const frames = decodeFrames(buildSlowRunSseBody(validInput));
        const types = frames.map((f) => f.type);

        expect(types[0]).toBe(EventType.RUN_STARTED);
        expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
        expect(types).not.toContain(EventType.RUN_FINISHED);
        expect(types).not.toContain(EventType.RUN_ERROR);
    });
});

describe("buildConnectReplaySseBody toolcall script (plan 05-04, RUNR-07)", () => {
    test("registered thread + script 'toolcall' replays a snapshot pairing toolCall with its ToolMessage (completed state)", () => {
        MockAgui.prototype.registerThread("t-replay-tc");
        const frames = decodeFrames(buildConnectReplaySseBody("t-replay-tc", "toolcall"));

        const snapshot = frames.find((f) => f.type === EventType.MESSAGES_SNAPSHOT) as
            | { type: EventType.MESSAGES_SNAPSHOT; messages: Array<{ id: string; role: string; content?: string; toolCalls?: Array<{ id: string }> }> }
            | undefined;
        expect(snapshot).toBeDefined();
        const assistant = snapshot!.messages.find((m) => m.role === "assistant");
        expect(assistant?.toolCalls?.[0]?.id).toBe("tc-bash");
        expect(snapshot!.messages.some((m) => m.role === "tool" && m.toolCallId === "tc-bash")).toBe(true);
        // Single terminal at the end.
        const types = frames.map((f) => f.type);
        expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    });

    test("default script replay stays quick (backward compatible)", () => {
        MockAgui.prototype.registerThread("t-replay-quick");
        const frames = decodeFrames(buildConnectReplaySseBody("t-replay-quick"));
        const snapshot = frames.find((f) => f.type === EventType.MESSAGES_SNAPSHOT) as
            | { type: EventType.MESSAGES_SNAPSHOT; messages: Array<{ id: string; role: string; content?: string }> }
            | undefined;
        expect(snapshot!.messages).toEqual([{ id: "m1", role: "assistant", content: "hello" }]);
    });
});
