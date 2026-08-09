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
import { MockAgui, buildConnectReplaySseBody, buildErrorRunSseBody } from "./mock-agui";

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
