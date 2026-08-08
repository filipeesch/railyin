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
        // Give the run ~800ms to start streaming, then stop it mid-silence.
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Verified route (research Pitfall 4): threadId lives in the PATH for
        // multi-route mode — POST /agent/:agentId/stop/:threadId.
        const stopRes = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/stop/t2`, { method: "POST" });
        expect(stopRes.status).toBe(200);
        const stopBody = (await stopRes.json()) as Record<string, unknown>;
        expect(stopBody.stopped).toBe(true);

        // The stream still completes cleanly once the silence elapses.
        const awaited = await runRes;
        expect(awaited.status).toBe(200);
        const frames = parseSseFrames(await awaited.text());
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    });
});
