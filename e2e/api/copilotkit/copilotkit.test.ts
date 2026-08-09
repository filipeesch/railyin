/**
 * copilotkit.test.ts — CopilotRuntime mount probe (HOST-01/02, D-05/D-06, D-08).
 *
 * All `/api/copilotkit/*` calls use RAW fetch against server.baseUrl — the
 * endpoint speaks AG-UI, NOT the RPC protocol in `src/shared/rpc-types.ts`,
 * so the typed `server.request()` helper cannot reach it. That boundary is
 * deliberate: the runtime mount is the one exception to the RPC contract
 * (CONTEXT.md "the runtime mount is an exception — it speaks AG-UI, not RPC").
 *
 * The server is spawned with `copilotkitProbe: true`, which sets
 * RAILYN_COPILOTKIT_PROBE=1 so the composition root registers the ScriptedAgent.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, type TestServer } from "../fixtures/server";

let server: TestServer;

beforeAll(async () => {
    server = await startServer({ copilotkitProbe: true });
}, 20_000);

afterAll(async () => {
    if (server) {
        await server.shutdown();
    }
});

/** Raw fetch helper for AG-UI endpoints (not part of RailynAPI). */
function postJson(path: string, body: unknown) {
    return fetch(`${server.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
    });
}

/** Split an SSE body on the \n\n frame separator and parse each data: line. */
function parseSseFrames(body: string): Record<string, unknown>[] {
    return body
        .split("\n\n")
        .filter(Boolean)
        .map((frame) => JSON.parse(frame.slice("data: ".length)) as Record<string, unknown>);
}

/** A minimal valid RunAgentInput (RunAgentInputSchema: threadId/runId required). */
function runInput(threadId: string, runId: string, forwardedProps: unknown = {}) {
    return {
        threadId,
        runId,
        tools: [],
        context: [],
        forwardedProps,
        state: [],
        messages: [],
    };
}

describe("CopilotRuntime mount (HOST-01)", () => {
    test("A: GET /api/copilotkit/info advertises agents.default and mode sse", async () => {
        const res = await fetch(`${server.baseUrl}/api/copilotkit/info`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
        const body = (await res.json()) as Record<string, unknown>;
        expect((body.agents as Record<string, unknown>).default).toBeDefined();
        expect(body.mode).toBe("sse");
    });

    test("B: POST run round-trips SSE with RUN_STARTED first, RUN_FINISHED last, no CORS header", async () => {
        const res = await postJson("/api/copilotkit/agent/default/run", runInput("t1", "r1", { script: "quick" }));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        // D-03 same-origin reconfirm: the runtime must NOT emit CORS headers.
        expect(res.headers.get("access-control-allow-origin")).toBeNull();

        const frames = parseSseFrames(await res.text());
        expect(frames.length).toBeGreaterThanOrEqual(5);
        expect(frames[0].type).toBe("RUN_STARTED");
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    });

    test("C: POST stop/:threadId during a silence run returns {stopped:true}", async () => {
        // Fire the run but do not await the body — the agent pauses for 5s.
        const runRes = postJson("/api/copilotkit/agent/default/run", runInput("t2", "r2", { script: "silence", silenceMs: 5000 }));

        // Synchronize on observable state (WR-01): retry the stop until the
        // runner reports an active run — no fixed-sleep timing dependence. The
        // run stays active for silenceMs (5s), so a bounded retry always lands
        // mid-run on a healthy server.
        const deadline = Date.now() + 4000;
        let stopBody: Record<string, unknown> = { stopped: false };
        while (Date.now() < deadline && stopBody.stopped !== true) {
            const stopRes = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/stop/t2`, { method: "POST" });
            expect(stopRes.status).toBe(200);
            stopBody = (await stopRes.json()) as Record<string, unknown>;
            if (stopBody.stopped !== true) await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Verified route (research Pitfall 4): threadId lives in the PATH for
        // multi-route mode — POST /agent/:agentId/stop/:threadId.
        expect(stopBody.stopped).toBe(true);

        // The stream still completes cleanly once the silence elapses.
        const awaited = await runRes;
        expect(awaited.status).toBe(200);
        const frames = parseSseFrames(await awaited.text());
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    }, 10_000);
});

describe("CopilotRuntime expansion probes (HOST-02, D-06, T-1-04/05, D-08)", () => {
    test("4: HOST-02 — stream survives a >30s agent silence (server.timeout(req,0) override)", async () => {
        // silenceMs 32000 exceeds the global Bun idleTimeout of 30s. If the
        // per-request override in src/bun/index.ts is missing, Bun kills this
        // stream mid-silence and neither TEXT_MESSAGE_CONTENT nor RUN_FINISHED
        // ever arrive. Accepted latency note: the >30s silence IS the HOST-02
        // evidence, so this test inherently runs longer than the Nyquist
        // guideline — the 60s per-test timeout is the planned accommodation.
        const res = await postJson("/api/copilotkit/agent/default/run", runInput("t3", "r3", { script: "silence", silenceMs: 32000 }));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");

        const frames = parseSseFrames(await res.text());
        expect(frames.some((f) => f.type === "TEXT_MESSAGE_CONTENT" && f.delta === "hello")).toBe(true);
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    }, 60_000);

    test("5: D-06 — connect on a never-run thread returns an empty SSE snapshot (zero frames)", async () => {
        const res = await postJson("/api/copilotkit/agent/default/connect", runInput("never-run-1", "r-connect-1"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        // Pitfall 6: InMemoryAgentRunner's ReplaySubject completes empty for a
        // never-run thread — the verified contract, not a bug.
        const frames = parseSseFrames(await res.text());
        expect(frames).toHaveLength(0);
    });

    test("6: T-1-05 — malformed RunAgentInput returns 400 Invalid request body", async () => {
        const res = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/run`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            body: "not-json{{{",
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.error).toBe("Invalid request body");
    });

    test("7: T-1-04 — unknown copilotkit subpath returns the runtime's own 404, not the RPC router's", async () => {
        const res = await fetch(`${server.baseUrl}/api/copilotkit/not-a-route`);
        expect(res.status).toBe(404);
        const body = (await res.json()) as Record<string, unknown>;
        // The RPC router would answer "Unknown method: ..." — this proves the
        // prefix mount owns /api/copilotkit/* (Pitfall 3).
        expect(body.error).toBe("Not found");
    });

    test("8: D-08 — GET /threads lists the run thread; /threads/:threadId/events recorded as evidence", async () => {
        // Order matters: test B ran on "t1" earlier in this file. The thread
        // store is process-local (Pitfall 6) — same server, same process.
        const res = await fetch(`${server.baseUrl}/api/copilotkit/threads`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { threads: { id: string }[]; nextCursor: string | null };
        expect(Array.isArray(body.threads)).toBe(true);
        expect(body.nextCursor).toBeNull();
        expect(body.threads.some((t) => t.id === "t1")).toBe(true);

        // Route-shape discovery (verified against fetch-router.mjs): 1.66.4
        // matches `threads/<threadId>/events` (threadId at len-2, "events"
        // LAST) — the research-assumed `/threads/events/:threadId` shape is a
        // 404. Record the 404 as correction evidence, then assert the REAL
        // route and log its body verbatim for the Phase 4 contract.
        const assumed = await fetch(`${server.baseUrl}/api/copilotkit/threads/events/t1`);
        const assumedBody = await assumed.text();
        console.log(`[D-08 evidence] assumed GET /threads/events/t1 -> ${assumed.status} ${assumedBody.slice(0, 100)} (route is threads/:threadId/events)`);

        const evRes = await fetch(`${server.baseUrl}/api/copilotkit/threads/t1/events`);
        const evBody = await evRes.text();
        console.log(`[D-08 evidence] GET /api/copilotkit/threads/t1/events -> ${evRes.status} ${evBody.slice(0, 200)}`);
        expect(evRes.status).toBe(200);
        const evParsed = JSON.parse(evBody) as { events: { type: string }[] };
        expect(Array.isArray(evParsed.events)).toBe(true);
        expect(evParsed.events[0].type).toBe("RUN_STARTED");
    });
});
