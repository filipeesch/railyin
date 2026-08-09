/**
 * sse-text-diff.test.ts — D-07 fixture validation (research Pattern 3): proves
 * the MockAgui fixture's SSE output is byte-identical to the real
 * CopilotRuntime's wire text for the same scripted quick scenario.
 *
 * Two layers:
 *  - Unit (no server): the fixture's body builder frames the canonical quick
 *    event sequence as `data: {json}\n\n` with no event:/id: fields.
 *  - Diff (real server): startServer({ copilotkitProbe: true }) + raw fetch
 *    capture vs the same scenario through the fixture builder — strict
 *    equality on the split frames arrays, plus shared response headers.
 *    (The diff describe is added in plan 01-03 Task 2.)
 *
 * Connect parity (WR-01): the CONNECT replay is NOT byte-identical to the
 * real runner on the registered-thread path — the real in-memory runner
 * replays compacted historic events only and never emits MESSAGES_SNAPSHOT,
 * while the fixture appends a synthetic snapshot. The tests below pin the
 * shared client-contract invariants (first RUN_STARTED / single terminal
 * RUN_FINISHED last / no events after the terminal) on BOTH sides, assert the
 * never-run connect body IS byte-identical (empty on both), and document the
 * deliberate divergence with the client-merge rationale.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildQuickRunSseBody, buildConnectReplaySseBody, MOCK_AGUI_SSE_HEADERS } from "../../ui/fixtures/mock-agui";
import { startServer, type TestServer } from "../fixtures/server";

/** The exact RunAgentInput the diff scenario POSTs (and the fixture parses). */
const requestInput = {
    threadId: "diff-t1",
    runId: "diff-r1",
    tools: [],
    context: [],
    forwardedProps: { script: "quick" },
    state: [],
    messages: [],
};

/** Split an SSE body on the \n\n frame separator, dropping the trailing empty. */
function framesOf(sseText: string): string[] {
    return sseText.split("\n\n").filter(Boolean);
}

function parseFrame<T>(frame: string): T {
    return JSON.parse(frame.slice("data: ".length)) as T;
}

describe("MockAgui SSE body builder (fixture framing, D-07)", () => {
    test("quick scenario produces 5 `data: {json}` frames with no event:/id: fields", () => {
        const frames = framesOf(buildQuickRunSseBody(requestInput));

        expect(frames).toHaveLength(5);
        for (const frame of frames) {
            expect(frame.startsWith("data: ")).toBe(true);
            expect(frame).not.toMatch(/^event:/);
            expect(frame).not.toMatch(/^id:/);
            // Single-line frames: parseable JSON after the data: prefix.
            expect(parseFrame(frame)).toBeDefined();
        }

        const first = parseFrame<{ type: string }>(frames[0]);
        expect(first.type).toBe("RUN_STARTED");
        const last = parseFrame<{ type: string }>(frames[frames.length - 1]);
        expect(last.type).toBe("RUN_FINISHED");
    });

    test("RUN_STARTED carries the runner-patched input (schema key order)", () => {
        const frames = framesOf(buildQuickRunSseBody(requestInput));
        const started = parseFrame<Record<string, unknown>>(frames[0]);
        expect(started.input).toEqual({
            threadId: "diff-t1",
            runId: "diff-r1",
            state: [],
            messages: [],
            tools: [],
            context: [],
            forwardedProps: { script: "quick" },
        });
    });

    test("fixture declares the real runtime's SSE response headers", () => {
        expect(MOCK_AGUI_SSE_HEADERS["content-type"]).toBe("text/event-stream");
        expect(MOCK_AGUI_SSE_HEADERS["cache-control"]).toBe("no-cache");
    });
});

describe("SSE text diff vs the real server (D-07, Pattern 3)", () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer({ copilotkitProbe: true });
    }, 20_000);

    afterAll(async () => {
        if (server) {
            await server.shutdown();
        }
    });

    test("fixture frames are byte-identical to real captured frames (quick scenario)", async () => {
        const res = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/run`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify(requestInput),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");

        // Real side: raw SSE body captured in-test (no committed capture file
        // that could go stale). Fixture side: same scenario through the
        // fixture's body builder.
        const realBody = await res.text();
        const fixtureBody = buildQuickRunSseBody(requestInput);
        const realFrames = framesOf(realBody);
        const fixtureFrames = framesOf(fixtureBody);

        // Byte-identical data: lines — catches framing drift (event:/id:
        // fields, key order, double newlines).
        expect(fixtureFrames).toEqual(realFrames);
        // Full-text byte equality (strictly stronger than frame equality —
        // also pins the trailing \n\n framing and separator counts).
        expect(fixtureBody).toBe(realBody);
        expect(realBody.endsWith("\n\n")).toBe(true);

        // Shared response headers.
        expect(res.headers.get("cache-control")).toBe(MOCK_AGUI_SSE_HEADERS["cache-control"]);
        expect(res.headers.get("content-type")).toBe(MOCK_AGUI_SSE_HEADERS["content-type"]);
    });

    test("never-run connect: fixture empty replay is byte-identical to the real runner's (RUNR-06, WR-01)", async () => {
        const threadId = "diff-connect-never";
        const res = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/connect`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({ ...requestInput, threadId, runId: "diff-connect-never-r" }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");

        const realBody = await res.text();
        // The fixture's never-run path (unregistered thread) is an empty body.
        const fixtureBody = buildConnectReplaySseBody(threadId, "quick", new Set());
        expect(fixtureBody).toBe("");
        // Byte-identical on this branch: the real runner also completes the
        // connect stream with zero frames for a thread with no store.
        expect(realBody).toBe(fixtureBody);
        expect(res.headers.get("cache-control")).toBe(MOCK_AGUI_SSE_HEADERS["cache-control"]);
    });

    test("connect replay contract: fixture snapshot framing vs the real compacted replay (WR-01)", async () => {
        // Give the real runner history: run the quick script on a fresh thread
        // and drain the stream so the run finalizes into the historic store.
        const threadId = "diff-connect-run";
        const runRes = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/run`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({ ...requestInput, threadId, runId: "diff-connect-run-r" }),
        });
        expect(runRes.status).toBe(200);
        await runRes.text();

        // Real side: connect replays the COMPACTED historic events only
        // (in-memory.mjs connect(): compactEvents(allHistoricEvents)) — first
        // frame RUN_STARTED, single terminal RUN_FINISHED last, and NEVER a
        // MESSAGES_SNAPSHOT (the runner does not synthesize one).
        const connectRes = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/connect`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({ ...requestInput, threadId, runId: "diff-connect-run-c" }),
        });
        expect(connectRes.status).toBe(200);
        const realFrames = framesOf(await connectRes.text()).map((f) => parseFrame<{ type: string }>(f));
        expect(realFrames.length).toBeGreaterThan(0);
        expect(realFrames[0].type).toBe("RUN_STARTED");
        expect(realFrames[realFrames.length - 1].type).toBe("RUN_FINISHED");
        expect(realFrames.filter((f) => f.type === "RUN_FINISHED")).toHaveLength(1);
        expect(realFrames.some((f) => f.type === "MESSAGES_SNAPSHOT")).toBe(false);

        // Fixture side: the same thread through the replay builder — the
        // historic sequence PLUS the synthetic MESSAGES_SNAPSHOT (test-authored
        // client convenience, WR-01) PLUS its own single terminal, with the
        // snapshot strictly before the terminal (verifyEvents rejects any
        // event after RUN_FINISHED). Behaviorally equivalent for the client:
        // the @ag-ui/client MESSAGES_SNAPSHOT handler replaces the message list
        // by id, so the snapshot masks the replayed events and the rendered
        // final state matches the real replay's text-event reconstruction.
        const fixtureFrames = framesOf(buildConnectReplaySseBody(threadId, "quick", new Set([threadId]))).map((f) =>
            parseFrame<{ type: string }>(f),
        );
        expect(fixtureFrames[0].type).toBe("RUN_STARTED");
        expect(fixtureFrames[fixtureFrames.length - 1].type).toBe("RUN_FINISHED");
        expect(fixtureFrames.filter((f) => f.type === "RUN_FINISHED")).toHaveLength(1);
        const snapshotIdx = fixtureFrames.findIndex((f) => f.type === "MESSAGES_SNAPSHOT");
        expect(snapshotIdx).toBeGreaterThan(0);
        expect(snapshotIdx).toBeLessThan(fixtureFrames.length - 1);
        // The snapshot carries the message the replayed TEXT events reconstruct.
        const snapshot = fixtureFrames[snapshotIdx] as {
            type: string;
            messages?: Array<{ id: string; role: string; content?: string }>;
        };
        expect(snapshot.messages).toEqual([{ id: "m1", role: "assistant", content: "hello" }]);
    });
});
