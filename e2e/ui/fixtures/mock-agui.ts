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
 * Build the SSE body for the scripted ERROR run (plan 05-03 Task 2): the
 * quick event sequence up to the assistant text message, then a terminal
 * RUN_ERROR carrying "simulated failure" instead of RUN_FINISHED. Same
 * EventEncoder + patchRunStartedInput path as buildQuickRunSseBody — the
 * RUN_ERROR must be the LAST frame (the client's verifyEvents rejects any
 * event after RUN_ERROR).
 */
export function buildErrorRunSseBody(requestInput: unknown): string {
    const parsed = RunAgentInputSchema.parse(requestInput);
    const encoder = new EventEncoder();
    const events: AGUIEvent[] = [
        { type: EventType.RUN_STARTED, threadId: parsed.threadId, runId: parsed.runId },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hello" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
        { type: EventType.RUN_ERROR, message: "simulated failure" },
    ];
    return events
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

/**
 * Stable runId used for every connect replay — the replay is a synthetic
 * "replay run" framing the thread's historic events (RUNR-05).
 */
const REPLAY_RUN_ID = "replay-run";

/** Run script variants served by POST /run (plan 05-04 Task 3). */
export type RunScript = "quick" | "error" | "toolcall" | "reasoning" | "interrupt" | "slow";

/** DecisionRequestPayload for the "interrupt" script (mirrors buildInterruptOutcome, event-bridge.ts:342-378). */
const INTERRUPT_PAYLOAD = {
    context: "The agent needs your input before continuing.",
    questions: [
        {
            question: "Should I apply the changes to src/auth.ts?",
            type: "exclusive",
            weight: "medium",
            options: [
                { title: "Yes, apply them", description: "Apply the proposed changes as-is." },
                { title: "No, revise first", description: "Ask the agent to revise the approach." },
            ],
        },
        {
            question: "How should edge cases be handled?",
            type: "exclusive",
            weight: "easy",
            options: [
                { title: "Fail loudly", description: "Surface an error on unexpected input." },
                { title: "Graceful default", description: "Fall back to safe defaults." },
            ],
        },
    ],
};

/**
 * Canonical tool-call run (plan 05-04 Task 3): text, a generic tool
 * (create_card → default card), then the domain families — bash
 * (ShellOutputRenderer), subagent (DelegateSummaryRenderer), write_file
 * (FileChangesRenderer with +N/−N stats). Event shapes mirror the bridge
 * (event-bridge.ts:159-239): TOOL_CALL_START carries name+args only (no
 * display.contentType), args/result arrive as full-JSON deltas, and every
 * TOOL_CALL_RESULT carries the canonical { messageId: `${id}-result`, role:
 * "tool" } shape (event-bridge.ts:64-72).
 */
export function buildToolCallRunEvents(threadId: string, runId: string): AGUIEvent[] {
    return [
        { type: EventType.RUN_STARTED, threadId, runId },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "Handling that now." },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
        // Generic / MCP tool → useDefaultRenderTool card (D-04).
        { type: EventType.TOOL_CALL_START, toolCallId: "tc-card", toolCallName: "create_card" },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc-card", delta: JSON.stringify({ title: "A new card" }) },
        { type: EventType.TOOL_CALL_END, toolCallId: "tc-card" },
        { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc-card", messageId: "tc-card-result", content: JSON.stringify({ ok: true }), role: "tool" },
        // Shell family → ShellOutputRenderer.
        { type: EventType.TOOL_CALL_START, toolCallId: "tc-bash", toolCallName: "bash" },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc-bash", delta: JSON.stringify({ command: "ls -la" }) },
        { type: EventType.TOOL_CALL_END, toolCallId: "tc-bash" },
        { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc-bash", messageId: "tc-bash-result", content: "total 8\n-rw-r--r--  1 user staff  12 Jul 1 12:00 README.md", role: "tool" },
        // Delegate family → DelegateSummaryRenderer.
        { type: EventType.TOOL_CALL_START, toolCallId: "tc-sub", toolCallName: "subagent" },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc-sub", delta: JSON.stringify({ intent: "Write the auth module", prompt: "Implement the auth module with JWT." }) },
        { type: EventType.TOOL_CALL_END, toolCallId: "tc-sub" },
        { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc-sub", messageId: "tc-sub-result", content: "## Done\nAuth module implemented with refresh rotation.", role: "tool" },
        // Write family → FileChangesRenderer (+N/−N stats from args).
        { type: EventType.TOOL_CALL_START, toolCallId: "tc-write", toolCallName: "write_file" },
        { type: EventType.TOOL_CALL_ARGS, toolCallId: "tc-write", delta: JSON.stringify({ path: "src/auth.ts", content: "line1\nline2" }) },
        { type: EventType.TOOL_CALL_END, toolCallId: "tc-write" },
        { type: EventType.TOOL_CALL_RESULT, toolCallId: "tc-write", messageId: "tc-write-result", content: "wrote 2 lines", role: "tool" },
        { type: EventType.RUN_FINISHED, threadId, runId, result: null },
    ];
}

/** EventEncoder-framed SSE body for the tool-call run (same patch path as the quick builder). */
export function buildToolCallRunSseBody(requestInput: unknown): string {
    const parsed = RunAgentInputSchema.parse(requestInput);
    const encoder = new EventEncoder();
    return buildToolCallRunEvents(parsed.threadId, parsed.runId)
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

/**
 * Reasoning run (CHAT-05, BRDG-02): REASONING_MESSAGE_START/CONTENT/END
 * mirroring the bridge's reasoning branch (event-bridge.ts:143-156, role
 * "reasoning"), then the text message, then the terminal. CopilotChatReasoningMessage
 * renders the card zero-config (D-09).
 */
export function buildReasoningRunSseBody(requestInput: unknown): string {
    const parsed = RunAgentInputSchema.parse(requestInput);
    const encoder = new EventEncoder();
    const events: AGUIEvent[] = [
        { type: EventType.RUN_STARTED, threadId: parsed.threadId, runId: parsed.runId },
        { type: EventType.REASONING_MESSAGE_START, messageId: "r1", role: "reasoning" },
        { type: EventType.REASONING_MESSAGE_CONTENT, messageId: "r1", delta: "Comparing two candidate designs before answering." },
        { type: EventType.REASONING_MESSAGE_END, messageId: "r1" },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "here is the answer" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
        { type: EventType.RUN_FINISHED, threadId: parsed.threadId, runId: parsed.runId, result: null },
    ];
    return events
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

/**
 * Interrupt run (D-06): RUN_FINISHED with the canonical interrupt outcome
 * (buildInterruptOutcome parity, event-bridge.ts:342-378) carrying a
 * DecisionRequestPayload with two exclusive questions. The decision card
 * renders via the #interrupt slot; the resume POST /run carries the answers.
 */
export function buildInterruptRunSseBody(requestInput: unknown): string {
    const parsed = RunAgentInputSchema.parse(requestInput);
    const encoder = new EventEncoder();
    const events: AGUIEvent[] = [
        { type: EventType.RUN_STARTED, threadId: parsed.threadId, runId: parsed.runId },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "What do you think?" },
        { type: EventType.TEXT_MESSAGE_END, messageId: "m1" },
        {
            type: EventType.RUN_FINISHED,
            threadId: parsed.threadId,
            runId: parsed.runId,
            outcome: {
                type: "interrupt",
                interrupts: [
                    {
                        id: "decision-interrupt-1",
                        reason: "decision_request",
                        message: "A decision is required.",
                        metadata: INTERRUPT_PAYLOAD,
                    },
                ],
            },
        },
    ];
    return events
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

/**
 * Slow run (CHAT-04 stop scenario): text chunks with NO terminal — the run
 * stays isRunning until the client aborts, so the spec can click stop
 * mid-stream deterministically. The fixture's /run branch delays the fulfill
 * (the client aborts the fetch on stop; the abort finalizes the run and the
 * "Stopped" marker renders — client state only, D-08).
 */
export function buildSlowRunEvents(threadId: string, runId: string): AGUIEvent[] {
    return [
        { type: EventType.RUN_STARTED, threadId, runId },
        { type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "working on it" },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "… still working" },
    ];
}

/** SSE body for the slow run (no terminal — the run never self-completes). */
export function buildSlowRunSseBody(requestInput: unknown): string {
    const parsed = RunAgentInputSchema.parse(requestInput);
    const encoder = new EventEncoder();
    return buildSlowRunEvents(parsed.threadId, parsed.runId)
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

/**
 * Fixture-side thread registry (RUNR-06): threadIds the spec pre-registered
 * via MockAgui.registerThread(). A thread NOT in this set has never run —
 * connect answers with an empty SSE body, mirroring the real runner's
 * never-run path (RUNR-06: base runner completes empty for unknown threads).
 *
 * WR-05: the registry lives on the MockAgui INSTANCE (created fresh per test
 * by the auto-use `agui` fixture) — a module-level registry accumulated
 * registerThread() calls across every test in a Playwright worker, silently
 * breaking the empty-body contract for reused threadIds.
 */

/**
 * Build the SSE body for a connect request (CHAT-07 history replay, RUNR-05):
 * RUN_STARTED + the historic event sequence (quick by default; the tool-call
 * sequence when script === "toolcall") + a MESSAGES_SNAPSHOT listing the
 * replayed messages + a single final RUN_FINISHED. Every frame goes through
 * the same EventEncoder + patchRunStartedInput path as buildQuickRunSseBody —
 * never hand-rolled frames.
 *
 * A never-run thread (not in `knownThreadIds`) yields an EMPTY body (RUNR-06).
 */
export function buildConnectReplaySseBody(
  threadId: string,
  script: RunScript = "quick",
  knownThreadIds: ReadonlySet<string> = new Set(),
): string {
    if (!knownThreadIds.has(threadId)) {
        return "";
    }
    const parsed = RunAgentInputSchema.parse({
        threadId,
        runId: REPLAY_RUN_ID,
        messages: [],
        tools: [],
        context: [],
        forwardedProps: { script },
    });
    const encoder = new EventEncoder();
    // buildQuickRunEvents / buildToolCallRunEvents already end with
    // RUN_FINISHED; the connect replay must expose a SINGLE terminal event
    // AFTER the snapshot (the client's verifyEvents rejects any event after
    // RUN_FINISHED), so the historic run's terminal is dropped and the replay
    // appends its own.
    const historic = (script === "toolcall" ? buildToolCallRunEvents(threadId, REPLAY_RUN_ID) : buildQuickRunEvents(threadId, REPLAY_RUN_ID)).filter(
        (event) => event.type !== EventType.RUN_FINISHED,
    );
    // Tool-call replay snapshot (RUNR-07 / D-05): the assistant message pairs
    // its toolCall with the ToolMessage, so the client's slot resolution
    // derives status "complete" — a reopened thread never shows a stale
    // "running" card.
    const snapshotMessages =
        script === "toolcall"
            ? [
                  {
                      id: "a1",
                      role: "assistant",
                      content: "Handled the command.",
                      toolCalls: [{ id: "tc-bash", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "ls -la" }) } }],
                  },
                  { id: "t1", role: "tool", toolCallId: "tc-bash", content: "total 8" },
              ]
            : [{ id: "m1", role: "assistant", content: "hello" }];
    const replayEvents: AGUIEvent[] = [
        ...historic,
        {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: snapshotMessages,
        },
        { type: EventType.RUN_FINISHED, threadId, runId: REPLAY_RUN_ID, result: null },
    ];
    return replayEvents
        .map((event) => encoder.encode(patchRunStartedInput(event, parsed)))
        .join("");
}

export class MockAgui {
    private _page: Page;

    /**
     * Run script selection (plan 05-03 Task 2 + 05-04 Task 3): "quick"
     * (default) serves buildQuickRunSseBody; "error" serves the RUN_ERROR
     * body; "toolcall" / "reasoning" / "interrupt" serve their variant
     * bodies; "slow" delays the /run fulfill with a terminal-less body so the
     * stop scenario can click mid-run. Connect replays use the quick
     * sequence, except script === "toolcall" which replays the tool-call
     * sequence + completed snapshot (RUNR-07).
     */
    script: RunScript = "quick";

    /** Every POST /run request body, in order (last one is `lastRunInput`). */
    runInputs: unknown[] = [];

    /** The most recent POST /run request body (plan 05-04 Task 3 resume capture). */
    lastRunInput: unknown = null;

    /** ThreadIds captured from POST /agent/:agentId/stop/:threadId (CHAT-04). */
    stopRequests: string[] = [];

    /**
     * Per-instance thread registry (WR-05): registerThread() only affects
     * THIS fixture instance — the auto-use fixture creates one MockAgui per
     * test, so cross-test state can never leak into another test's connect
     * replay.
     */
    readonly knownThreadIds = new Set<string>();

    constructor(page: Page) {
        this._page = page;
    }

    /**
     * Pre-register a threadId as "has run" so connect replays its history
     * (RUNR-06: threads never registered answer connect with an empty body).
     */
    registerThread(threadId: string): this {
        this.knownThreadIds.add(threadId);
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
                // Resume capture (plan 05-04 Task 3): the decision scenario
                // asserts resume[] carries non-empty answers on the LAST /run.
                this.runInputs.push(body);
                this.lastRunInput = body;
                try {
                    if (this.script === "slow") {
                        // CHAT-04 stop scenario: hold the /run response open
                        // (no terminal in the body either), so the run stays
                        // isRunning until the spec clicks stop and the client
                        // aborts the fetch. The delayed fulfill then lands on
                        // a dead socket — expected, swallow it.
                        await new Promise((resolve) => setTimeout(resolve, 3_000));
                        try {
                            await route.fulfill({
                                status: 200,
                                contentType: MOCK_AGUI_SSE_HEADERS["content-type"],
                                headers: { "cache-control": MOCK_AGUI_SSE_HEADERS["cache-control"] },
                                body: buildSlowRunSseBody(body),
                            });
                        } catch {
                            // Client aborted the fetch mid-delay — the run
                            // finalized client-side; nothing to deliver.
                        }
                        return;
                    }
                    const sseBody =
                        this.script === "error"
                            ? buildErrorRunSseBody(body)
                            : this.script === "toolcall"
                              ? buildToolCallRunSseBody(body)
                              : this.script === "reasoning"
                                ? buildReasoningRunSseBody(body)
                                : this.script === "interrupt"
                                  ? buildInterruptRunSseBody(body)
                                  : buildQuickRunSseBody(body);
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
                    body: buildConnectReplaySseBody(threadId, this.script, this.knownThreadIds),
                });
                return;
            }

            // POST /api/copilotkit/agent/:agentId/stop/:threadId — abort
            // acknowledgement (CHAT-04: the client's abortRun round-trips
            // through /stop; the threadId arrives in the URL PATH).
            if (route.request().method() === "POST" && /^\/api\/copilotkit\/agent\/[^/]+\/stop\/[^/]+$/.test(path)) {
                const threadId = path.split("/").pop() ?? "";
                if (threadId) this.stopRequests.push(threadId);
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
