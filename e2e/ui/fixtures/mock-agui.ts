/**
 * mock-agui.ts — SSE mock for the CopilotRuntime AG-UI endpoints
 * (/api/copilotkit/*), validated byte-for-byte against the real server by
 * e2e/api/copilotkit/sse-text-diff.test.ts (D-07, research Pattern 3).
 *
 * Usage:
 *   const agui = new MockAgui(page);
 *   await agui.install();           // registers page.route("/api/copilotkit/**")
 *   const api = new ApiMock(page);  // safe in either install order — ApiMock
 *   await api.install();            // route.fallback() hands /api/copilotkit/*
 *                                   // to this fixture (see mock-api.ts header)
 *
 * Routes (dispatch order: run → connect → stop → info → 404):
 *  - POST /agent/:agentId/run            — scripted SSE stream (quick run)
 *  - POST /agent/:agentId/connect        — SSE history replay (CHAT-07): for
 *    threads pre-registered via registerThread(), replays RUN_STARTED + the
 *    quick event sequence + MESSAGES_SNAPSHOT + RUN_FINISHED (RUNR-05);
 *    never-run threads get an empty 200 SSE body (RUNR-06)
 *  - POST /agent/:agentId/stop/:threadId — { success: true } (CHAT-04)
 *  - GET  /info                          — agent discovery
 *
 * Framing is NEVER hand-rolled — single sources of truth, so the fixture can
 * never drift from the real wire format:
 *  - SSE frames: EventEncoder from @ag-ui/encoder (the runtime's own encoder)
 *  - Run event sequence: buildQuickRunEvents from e2e/api/copilotkit/
 *    probe-agent.ts (the canonical builder the real ScriptedAgent emits)
 *  - RUN_STARTED input patch: replicates InMemoryAgentRunner's own patching
 *    (@copilotkit/runtime in-memory.mjs) so the wire text stays byte-identical
 *
 * Wired into e2e/ui/fixtures/index.ts as the auto-use `agui` fixture (Phase 5).
 * No @copilotkit/vue import anywhere (D-10 still holds).
 */

import type { Page, Route } from "@playwright/test";
import { EventEncoder } from "@ag-ui/encoder";
import { EventType, RunAgentInputSchema, type AGUIEvent, type RunAgentInput } from "@ag-ui/core";
import { buildQuickRunEvents } from "../../api/copilotkit/probe-agent";

/**
 * The SSE response headers the real runtime emits (verified against the real
 * server by the text-diff test). Used both for the fulfill() call and as the
 * fixture side of the header-equality assertion.
 */
export const MOCK_AGUI_SSE_HEADERS = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
} as const;

/**
 * Replicates InMemoryAgentRunner's RUN_STARTED input patching (in-memory.mjs):
 * when the agent's event omits `input`, the runner injects the sanitized
 * request input before framing. A fresh thread has no historic runs, so the
 * runner's historicMessageIds filter is a no-op and the patch is a plain
 * schema-ordered copy of the parsed input.
 */
function patchRunStartedInput(event: AGUIEvent, parsedInput: RunAgentInput): AGUIEvent {
    if (event.type === EventType.RUN_STARTED && !event.input) {
        return { ...event, input: { ...parsedInput } };
    }
    return event;
}

/**
 * Build the full SSE body for the scripted quick run — the same scenario the
 * real ScriptedAgent executes: EventEncoder-framed `data: {json}\n\n` frames
 * for the canonical quick event sequence, with the runner's RUN_STARTED input
 * patch applied so the text matches the real wire byte-for-byte.
 *
 * The forwardedProps.script knob (default "quick") selects the script in the
 * REAL agent; the fixture always emits the quick sequence (silence scripts
 * encode the same quick frames — the diff test only exercises quick mode).
 */
export function buildQuickRunSseBody(requestInput: unknown): string {
    const parsed = RunAgentInputSchema.parse(requestInput);
    const encoder = new EventEncoder();
    return buildQuickRunEvents(parsed.threadId, parsed.runId)
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

/**
 * Stable runId used for every connect replay — the replay is a synthetic
 * "replay run" framing the thread's historic events (RUNR-05).
 */
const REPLAY_RUN_ID = "replay-run";

/**
 * Fixture-side thread registry (RUNR-06): threadIds the spec pre-registered
 * via MockAgui.registerThread(). A thread NOT in this set has never run —
 * connect answers with an empty SSE body, mirroring the real runner's
 * never-run path (RUNR-06: base runner completes empty for unknown threads).
 */
const knownThreadIds = new Set<string>();

/**
 * Build the SSE body for a connect request (CHAT-07 history replay, RUNR-05):
 * RUN_STARTED + the quick event sequence (reusing buildQuickRunEvents, the
 * canonical builder) + a MESSAGES_SNAPSHOT listing the replayed messages +
 * a single final RUN_FINISHED. Every frame goes through the same
 * EventEncoder + patchRunStartedInput path as buildQuickRunSseBody — never
 * hand-rolled frames.
 *
 * A never-run thread (not in the registry) yields an EMPTY body (RUNR-06).
 */
export function buildConnectReplaySseBody(threadId: string): string {
    if (!knownThreadIds.has(threadId)) {
        return "";
    }
    const parsed = RunAgentInputSchema.parse({
        threadId,
        runId: REPLAY_RUN_ID,
        messages: [],
        tools: [],
        context: [],
        forwardedProps: { script: "quick" },
    });
    const encoder = new EventEncoder();
    // buildQuickRunEvents already ends with RUN_FINISHED; the connect replay
    // must expose a SINGLE terminal event AFTER the snapshot (the client's
    // verifyEvents rejects any event after RUN_FINISHED), so the quick
    // run's terminal is dropped and the replay appends its own.
    const historic = buildQuickRunEvents(threadId, REPLAY_RUN_ID).filter(
        (event) => event.type !== EventType.RUN_FINISHED,
    );
    const replayEvents: AGUIEvent[] = [
        ...historic,
        {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [{ id: "m1", role: "assistant", content: "hello" }],
        },
        { type: EventType.RUN_FINISHED, threadId, runId: REPLAY_RUN_ID, result: null },
    ];
    return replayEvents
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

export class MockAgui {
    private _page: Page;

    constructor(page: Page) {
        this._page = page;
    }

    /**
     * Pre-register a threadId as "has run" so connect replays its history
     * (RUNR-06: threads never registered answer connect with an empty body).
     */
    registerThread(threadId: string): this {
        knownThreadIds.add(threadId);
        return this;
    }

    async install(): Promise<void> {
        await this._page.route("/api/copilotkit/**", async (route: Route) => {
            const url = new URL(route.request().url());
            const path = url.pathname;

            // POST /api/copilotkit/agent/:agentId/run — scripted SSE stream.
            if (route.request().method() === "POST" && /^\/api\/copilotkit\/agent\/[^/]+\/run$/.test(path)) {
                let body: unknown = {};
                const raw = route.request().postData();
                if (raw) {
                    try {
                        body = JSON.parse(raw);
                    } catch {
                        // Malformed JSON — mirror the runtime's 400.
                        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Invalid request body" }) });
                        return;
                    }
                }
                try {
                    const sseBody = buildQuickRunSseBody(body);
                    await route.fulfill({
                        status: 200,
                        contentType: MOCK_AGUI_SSE_HEADERS["content-type"],
                        headers: { "cache-control": MOCK_AGUI_SSE_HEADERS["cache-control"] },
                        body: sseBody,
                    });
                } catch {
                    // Schema-invalid RunAgentInput — mirror the runtime's 400.
                    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Invalid request body" }) });
                }
                return;
            }

            // POST /api/copilotkit/agent/:agentId/connect — SSE history
            // replay (CHAT-07, RUNR-05/06). Mirrors the real runtime's
            // parseConnectRequest: the threadId arrives in the REQUEST BODY
            // (a full RunAgentInput), not the URL path — the path carries
            // only the agentId (fetch-router.mjs: "agent/connect").
            if (route.request().method() === "POST" && /^\/api\/copilotkit\/agent\/[^/]+\/connect$/.test(path)) {
                let threadId = "";
                const raw = route.request().postData();
                if (raw) {
                    try {
                        const body = JSON.parse(raw) as { threadId?: unknown };
                        if (typeof body.threadId === "string") threadId = body.threadId;
                    } catch {
                        // Malformed JSON — mirror the runtime's 400.
                        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Invalid request body" }) });
                        return;
                    }
                }
                await route.fulfill({
                    status: 200,
                    contentType: MOCK_AGUI_SSE_HEADERS["content-type"],
                    headers: { "cache-control": MOCK_AGUI_SSE_HEADERS["cache-control"] },
                    body: buildConnectReplaySseBody(threadId),
                });
                return;
            }

            // POST /api/copilotkit/agent/:agentId/stop/:threadId — abort
            // acknowledgement (CHAT-04: the client's abortRun round-trips
            // through /stop).
            if (route.request().method() === "POST" && /^\/api\/copilotkit\/agent\/[^/]+\/stop\/[^/]+$/.test(path)) {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ success: true }),
                });
                return;
            }

            // GET /api/copilotkit/info — mirrors the real /info shape
            // (agents.default + mode "sse"; T-1-09: capability additions in
            // Phase 6 must be re-validated against the real server first).
            if (route.request().method() === "GET" && path === "/api/copilotkit/info") {
                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        agents: { default: { id: "default", description: "Spike probe agent" } },
                        mode: "sse",
                    }),
                });
                return;
            }

            // Anything else the runtime doesn't serve (unknown subpaths).
            await route.fulfill({
                status: 404,
                contentType: "application/json",
                body: JSON.stringify({ error: "Not found" }),
            });
        });
    }
}
