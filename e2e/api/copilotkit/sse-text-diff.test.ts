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
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildQuickRunSseBody, MOCK_AGUI_SSE_HEADERS } from "../../ui/fixtures/mock-agui";
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
        const realFrames = framesOf(await res.text());
        const fixtureFrames = framesOf(buildQuickRunSseBody(requestInput));

        // Byte-identical data: lines — catches framing drift (event:/id:
        // fields, key order, double newlines).
        expect(fixtureFrames).toEqual(realFrames);

        // Shared response headers.
        expect(res.headers.get("cache-control")).toBe(MOCK_AGUI_SSE_HEADERS["cache-control"]);
        expect(res.headers.get("content-type")).toBe(MOCK_AGUI_SSE_HEADERS["content-type"]);
    });
});
