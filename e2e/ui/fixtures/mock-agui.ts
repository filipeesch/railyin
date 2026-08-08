/**
 * mock-agui.ts — SSE mock for the CopilotRuntime AG-UI endpoints
 * (/api/copilotkit/*), validated byte-for-byte against the real server by
 * e2e/api/copilotkit/sse-text-diff.test.ts (D-07, research Pattern 3).
 *
 * Usage (Phase 6):
 *   const agui = new MockAgui(page);
 *   await agui.install();           // registers page.route("/api/copilotkit/**")
 *   const api = new ApiMock(page);  // safe in either install order — ApiMock
 *   await api.install();            // route.fallback() hands /api/copilotkit/*
 *                                   // to this fixture (see mock-api.ts header)
 *
 * Framing is NEVER hand-rolled — single sources of truth, so the fixture can
 * never drift from the real wire format:
 *  - SSE frames: EventEncoder from @ag-ui/encoder (the runtime's own encoder)
 *  - Run event sequence: buildQuickRunEvents from e2e/api/copilotkit/
 *    probe-agent.ts (the canonical builder the real ScriptedAgent emits)
 *  - RUN_STARTED input patch: replicates InMemoryAgentRunner's own patching
 *    (@copilotkit/runtime in-memory.mjs) so the wire text stays byte-identical
 *
 * NOT wired into e2e/ui/fixtures/index.ts — Phase 6 consumes it; this phase
 * only builds + validates the class (install() shape identical from day one,
 * per PATTERNS.md). No @copilotkit/vue import anywhere (D-10 still holds).
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

export class MockAgui {
    private _page: Page;

    constructor(page: Page) {
        this._page = page;
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
