/**
 * railyin.test.ts — run-path wire tests through RailyinAgent + MockExecutionEngine.
 *
 * Spawns the REAL server WITHOUT the probe flag, so the composition root
 * registers RailyinAgent (D-12). The mock engine (RAILYN_TEST_EXECUTION_ENGINE=mock)
 * provides scripted tool/reasoning/error scenarios via prompt markers, proving
 * BRDG-01/02/03 and D-09 synthesis on the real wire (RUNR-01).
 *
 * All `/api/copilotkit/*` calls use RAW fetch against server.baseUrl — the
 * endpoint speaks AG-UI, NOT the RPC protocol in `src/shared/rpc-types.ts`
 * (the runtime mount is the documented exception).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type TestServer } from "../fixtures/server";

let server: TestServer;

beforeAll(async () => {
    // mcpConfig: {} populates server.dataDir (RAILYN_DATA_DIR) so the
    // durability tests can assert the JSONL log on disk (RUNR-02).
    server = await startServer({ mcpConfig: {} });
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

/** postJson against an arbitrary server (for the restart-replay test). */
function postJsonOn(baseUrl: string, path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
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

/** A minimal valid RunAgentInput with a user text message (schema-valid). */
function runInput(threadId: string, runId: string, text: string) {
    return {
        threadId,
        runId,
        tools: [],
        context: [],
        forwardedProps: {},
        state: [],
        messages: [{ id: "u1", role: "user", content: [{ type: "text", text }] }],
    };
}

/**
 * Schema-valid RESUME-run input (RunAgentInput.resume[]): history-only messages
 * (the run's user turn is the decision text — NOT a new prompt) plus the
 * canonical resume array `{ interruptId, status, payload }` (D-01/D-02).
 */
function resumeInput(threadId: string, runId: string, resume: { interruptId: string; status: string; payload?: unknown }[]) {
    return {
        threadId,
        runId,
        tools: [],
        context: [],
        forwardedProps: {},
        state: [],
        messages: [
            { id: "a1", role: "assistant", content: "I need your decision." },
            { id: "u1", role: "user", content: "history" },
        ],
        resume,
    };
}

describe("RailyinAgent run path (RUNR-01, D-12)", () => {
    test("a: chat turn on threadId=conversation.id streams RUN_STARTED (with input) first, RUN_FINISHED last", async () => {
        const session = await server.request("chatSessions.create", { title: "r1" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-a", "hello"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");

        const frames = parseSseFrames(await res.text());
        expect(frames.length).toBeGreaterThanOrEqual(3);
        expect(frames[0].type).toBe("RUN_STARTED");
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");

        // RUN_STARTED carries the input — the persisted user turn matches the wire.
        const started = frames[0] as { threadId: string; runId: string; input?: { messages: { role: string }[] } };
        expect(started.threadId).toBe(threadId);
        expect(started.runId).toBe("run-a");
        expect(started.input?.messages?.some((m) => m.role === "user")).toBe(true);
    });

    test("b: __SCRIPT_TOOLS__ streams REASONING_* and the full TOOL_CALL lifecycle (BRDG-02/03)", async () => {
        const session = await server.request("chatSessions.create", { title: "r2" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-b", "__SCRIPT_TOOLS__"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());

        const types = frames.map((f) => f.type);
        // Reasoning family present (BRDG-02)
        expect(types).toContain("REASONING_MESSAGE_START");
        expect(types).toContain("REASONING_MESSAGE_CONTENT");
        expect(types).toContain("REASONING_MESSAGE_END");
        // Complete tool lifecycle (BRDG-03)
        expect(types).toContain("TOOL_CALL_START");
        expect(types).toContain("TOOL_CALL_ARGS");
        expect(types).toContain("TOOL_CALL_END");
        expect(types).toContain("TOOL_CALL_RESULT");

        const result = frames.find((f) => f.type === "TOOL_CALL_RESULT") as {
            messageId?: string; toolCallId?: string; content?: string;
        };
        expect(result.messageId).toBe(`${result.toolCallId}-result`); // Pitfall 5
        expect(result.content).toBe("file contents");

        // ORDER within the run: START before ARGS before END before RESULT
        const startIdx = types.indexOf("TOOL_CALL_START");
        const argsIdx = types.indexOf("TOOL_CALL_ARGS");
        const endIdx = types.indexOf("TOOL_CALL_END");
        const resultIdx = types.indexOf("TOOL_CALL_RESULT");
        expect(startIdx).toBeGreaterThan(-1);
        expect(startIdx).toBeLessThan(argsIdx);
        expect(argsIdx).toBeLessThan(endIdx);
        expect(endIdx).toBeLessThan(resultIdx);

        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    });

    test("c: __SCRIPT_DANGLING_TOOL__ gets a synthesized TOOL_CALL_RESULT before RUN_FINISHED (D-09)", async () => {
        const session = await server.request("chatSessions.create", { title: "r3" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-c", "__SCRIPT_DANGLING_TOOL__"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());

        const types = frames.map((f) => f.type);
        expect(types).toContain("TOOL_CALL_START");
        expect(types).toContain("TOOL_CALL_RESULT");

        const result = frames.find((f) => f.type === "TOOL_CALL_RESULT") as {
            toolCallId?: string; content?: string;
        };
        expect(result.toolCallId).toBe("call_1");
        expect(result.content).toBe("");

        // The synthesized RESULT appears BEFORE the terminal.
        const resultIdx = types.indexOf("TOOL_CALL_RESULT");
        const finishedIdx = types.indexOf("RUN_FINISHED");
        expect(resultIdx).toBeGreaterThan(-1);
        expect(resultIdx).toBeLessThan(finishedIdx);
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    });

    test("d: __SCRIPT_ERROR__ streams a RUN_ERROR terminal frame (Pitfall 3)", async () => {
        const session = await server.request("chatSessions.create", { title: "r4" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-d", "__SCRIPT_ERROR__"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());

        expect(frames[frames.length - 1].type).toBe("RUN_ERROR");
        const err = frames[frames.length - 1] as { message?: string };
        expect(err.message).toBe("scripted failure");
    });

    test("e: unknown conversation threadId → RUN_ERROR THREAD_NOT_FOUND, no executor side effect (T-02-01)", async () => {
        const res = await postJson("/api/copilotkit/agent/default/run", runInput("999999", "run-e", "hello"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        expect(frames[0].type).toBe("RUN_STARTED");
        expect(frames[frames.length - 1].type).toBe("RUN_ERROR");
        expect(frames[frames.length - 1]).toMatchObject({ code: "THREAD_NOT_FOUND" });
    });

    test("f: non-numeric threadId → RUN_ERROR, never a filesystem/executor side effect (T-02-01)", async () => {
        const res = await postJson("/api/copilotkit/agent/default/run", runInput("../../etc/passwd", "run-f", "hello"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        expect(frames[frames.length - 1].type).toBe("RUN_ERROR");
    });

    test("g: cross-origin POST to the AG-UI mount → 403, no engine execution (WR-03)", async () => {
        // A hostile page (DNS-rebinding / CSRF) would POST with ITS OWN
        // Origin — the mount must reject before any engine work starts.
        const session = await server.request("chatSessions.create", { title: "r-cc" });
        const threadId = String(session.conversationId);
        const res = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/run`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "text/event-stream",
                origin: "https://evil.example.com",
            },
            body: JSON.stringify(runInput(threadId, "run-cc", "hello")),
        });
        expect(res.status).toBe(403);
        // Never an SSE stream — the body is the plain JSON rejection.
        expect((await res.text()).includes("Cross-origin")).toBe(true);
    });

    test("h: same-origin POST (Origin matching Host) passes the guard (WR-03)", async () => {
        const session = await server.request("chatSessions.create", { title: "r-co" });
        const threadId = String(session.conversationId);
        const host = new URL(server.baseUrl).host; // 127.0.0.1:PORT
        const res = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/run`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "text/event-stream",
                origin: `http://${host}`,
            },
            body: JSON.stringify(runInput(threadId, "run-co", "hello")),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        const frames = parseSseFrames(await res.text());
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
    });
});

describe("RailyinAgentRunner durability (RUNR-02/04/05/06/07)", () => {
    test("7: runs persist to data/threads/{conversationId}.jsonl — RUN_STARTED (with input) first, RUN_FINISHED last (RUNR-02)", async () => {
        const session = await server.request("chatSessions.create", { title: "d1" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-7", "__SCRIPT_TOOLS__"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");

        const logPath = join(server.dataDir, "threads", `${threadId}.jsonl`);
        expect(existsSync(logPath)).toBe(true);
        const lines = readFileSync(logPath, "utf-8").trim().split("\n");
        const first = JSON.parse(lines[0]);
        const last = JSON.parse(lines[lines.length - 1]);
        expect(first.type).toBe("RUN_STARTED");
        // The persisted user turn matches the wire.
        expect(first.input?.messages?.some((m: { role: string }) => m.role === "user")).toBe(true);
        expect(last.type).toBe("RUN_FINISHED");
    });

    test("8: connect on a never-run thread → 200 SSE, zero frames (RUNR-06)", async () => {
        const session = await server.request("chatSessions.create", { title: "d2" });
        const threadId = String(session.conversationId); // created but never run

        const res = await postJson("/api/copilotkit/agent/default/connect", runInput(threadId, "run-connect-8", "hello"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/event-stream");
        const frames = parseSseFrames(await res.text());
        expect(frames).toHaveLength(0);
    });

    test("9: second concurrent run on the same thread → 200 + EMPTY body, never a 500 (RUNR-04, Pitfall 2)", async () => {
        const session = await server.request("chatSessions.create", { title: "d3" });
        const threadId = String(session.conversationId);

        // Fire the slow run and do NOT await the body — it stays in flight.
        const first = postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-9a", "__SCRIPT_SLOW__"));
        // Let the first run pass dispatch and sit in its 2s pause.
        await new Promise((r) => setTimeout(r, 400));

        const second = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-9b", "hello"));
        expect(second.status).toBe(200);
        // Pitfall 2: the runner's synchronous throw surfaces as 200 + empty
        // SSE body — never a 500 status.
        const frames = parseSseFrames(await second.text());
        expect(frames).toHaveLength(0);

        // Close the first stream cleanly.
        const firstRes = await first;
        const firstFrames = parseSseFrames(await firstRes.text());
        expect(firstFrames[firstFrames.length - 1].type).toBe("RUN_FINISHED");
    }, 20_000);

    test("10: restart replay — same dataDir across two servers replays the log with completed tool calls (RUNR-05/07)", async () => {
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-durable-"));
        try {
            // Server A: run a tool-calling conversation into the durable dir.
            const serverA = await startServer({ mcpConfig: {}, dataDir: durableDir });
            const session = await serverA.request("chatSessions.create", { title: "d4" });
            const threadId = String(session.conversationId);
            const runRes = await postJsonOn(serverA.baseUrl, "/api/copilotkit/agent/default/run", runInput(threadId, "run-10", "__SCRIPT_TOOLS__"));
            expect(runRes.status).toBe(200);
            const runFrames = parseSseFrames(await runRes.text());
            expect(runFrames[runFrames.length - 1].type).toBe("RUN_FINISHED");
            await serverA.shutdown();

            // Server B: a FRESH process over the SAME durable data dir — the
            // in-memory store is empty, so connect replays the JSONL (the
            // #3553 cold-start fix).
            const serverB = await startServer({ mcpConfig: {}, dataDir: durableDir });
            try {
                const connectRes = await postJsonOn(serverB.baseUrl, "/api/copilotkit/agent/default/connect", runInput(threadId, "run-connect-10", "hello"));
                expect(connectRes.status).toBe(200);
                const frames = parseSseFrames(await connectRes.text());
                expect(frames.length).toBeGreaterThan(0);
                expect(frames[0].type).toBe("RUN_STARTED");
                expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
                // Completed tool call on replay — no stale running card.
                expect(frames.some((f) => f.type === "TOOL_CALL_RESULT")).toBe(true);
            } finally {
                await serverB.shutdown();
            }
        } finally {
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);
});

describe("decision cycle (RUNR-08, CHAT-09, D-09)", () => {
    /**
     * Run __SCRIPT_DECISION__ on a fresh thread and return the interrupt id from
     * the LAST frame — each test owns its thread and self-contained lifecycle.
     */
    async function openDecision(threadId: string, runId: string): Promise<string> {
        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, runId, "__SCRIPT_DECISION__"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        const last = frames[frames.length - 1] as {
            type?: string;
            outcome?: { type?: string; interrupts?: { id?: string }[] };
        };
        expect(last.type).toBe("RUN_FINISHED");
        expect(last.outcome?.type).toBe("interrupt");
        const id = last.outcome?.interrupts?.[0]?.id;
        expect(id).toMatch(/^decision-\d+-\d+$/);
        return id!;
    }

    test("11: __SCRIPT_DECISION__ ends with RUN_FINISHED outcome.interrupt — the run genuinely pauses (D-03)", async () => {
        const session = await server.request("chatSessions.create", { title: "dc1" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-11", "__SCRIPT_DECISION__"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());

        // The interrupt frame is the FINAL frame — the run ended at the decision,
        // never a RUN_ERROR (D-03: a normal completion, not a failure).
        const last = frames[frames.length - 1] as {
            type?: string;
            outcome?: { type?: string; interrupts?: { reason?: string; id?: string; message?: string; metadata?: unknown }[] };
        };
        expect(last.type).toBe("RUN_FINISHED");
        expect(frames.some((f) => f.type === "RUN_ERROR")).toBe(false);
        expect(last.outcome?.type).toBe("interrupt");

        const interrupt = last.outcome!.interrupts![0];
        expect(interrupt.reason).toBe("decision_request");
        expect(interrupt.id).toMatch(/^decision-\d+-\d+$/);
        expect(interrupt.message).toBe("mock context");
        // metadata carries the parsed DecisionRequestPayload — the Phase 5 card data (UI-03).
        const md = interrupt.metadata as { context?: string; questions?: unknown[] };
        expect(md.context).toBe("mock context");
        expect(Array.isArray(md.questions)).toBe(true);
    });

    test("12: plain run while a decision is pending → RUN_ERROR THREAD_BUSY (D-04)", async () => {
        const session = await server.request("chatSessions.create", { title: "dc2" });
        const threadId = String(session.conversationId);
        await openDecision(threadId, "run-12a");

        const res = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-12b", "hello"));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        expect(frames[frames.length - 1].type).toBe("RUN_ERROR");
        expect(frames[frames.length - 1]).toMatchObject({ code: "THREAD_BUSY" });
    });

    test("13: resume with a translated payload streams continuation frames and persists input.resume to JSONL (CHAT-09 SC2)", async () => {
        const session = await server.request("chatSessions.create", { title: "dc3" });
        const threadId = String(session.conversationId);
        const interruptId = await openDecision(threadId, "run-13a");

        const res = await postJson("/api/copilotkit/agent/default/run", resumeInput(threadId, "run-13b", [
            {
                interruptId,
                status: "resolved",
                payload: {
                    decision: "approved",
                    answers: [{ question: "Choose __DECISION_OPTION__", answer: "A", weight: "medium" }],
                },
            },
        ]));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        // Continuation: the engine received the translated decision (Phase B script
        // fires only when the formatted question reached the engine's prompt).
        expect(frames.some((f) => f.type === "TEXT_MESSAGE_CONTENT" && f.delta === "Decision received, continuing.")).toBe(true);
        expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");

        // The resume run's RUN_STARTED with input.resume[] is persisted on disk (RUNR-08).
        const logPath = join(server.dataDir, "threads", `${threadId}.jsonl`);
        const lines = readFileSync(logPath, "utf-8").trim().split("\n");
        const started = lines
            .map((l) => JSON.parse(l))
            .find((e) => e.type === "RUN_STARTED" && e.runId === "run-13b") as {
                input?: { resume?: { interruptId?: string }[] };
            };
        expect(started?.input?.resume?.[0]?.interruptId).toBe(interruptId);
    });

    test("14: resume with an unknown interruptId → RUN_ERROR INVALID_INTERRUPT (D-05)", async () => {
        const session = await server.request("chatSessions.create", { title: "dc4" });
        const threadId = String(session.conversationId);

        const res = await postJson("/api/copilotkit/agent/default/run", resumeInput(threadId, "run-14", [
            { interruptId: "decision-999999-1", status: "resolved", payload: { decision: "approved", answers: [{ question: "Q", answer: "A" }] } },
        ]));
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        expect(frames[frames.length - 1].type).toBe("RUN_ERROR");
        expect(frames[frames.length - 1]).toMatchObject({ code: "INVALID_INTERRUPT" });
    });

    test("15: cancelled resume completes plainly and the thread stays usable (A4)", async () => {
        const session = await server.request("chatSessions.create", { title: "dc5" });
        const threadId = String(session.conversationId);
        const interruptId = await openDecision(threadId, "run-15a");

        const cancelRes = await postJson("/api/copilotkit/agent/default/run", resumeInput(threadId, "run-15b", [
            { interruptId, status: "cancelled" },
        ]));
        expect(cancelRes.status).toBe(200);
        const cancelFrames = parseSseFrames(await cancelRes.text());
        // Plain RUN_FINISHED with NO continuation text — the dismissal delivers nothing.
        expect(cancelFrames[cancelFrames.length - 1].type).toBe("RUN_FINISHED");
        expect(cancelFrames.some((f) => f.type === "TEXT_MESSAGE_CONTENT")).toBe(false);

        // The thread is not wedged: a subsequent plain run succeeds.
        const nextRes = await postJson("/api/copilotkit/agent/default/run", runInput(threadId, "run-15c", "hello"));
        expect(nextRes.status).toBe(200);
        const nextFrames = parseSseFrames(await nextRes.text());
        expect(nextFrames[nextFrames.length - 1].type).toBe("RUN_FINISHED");
        expect(nextFrames.some((f) => f.type === "RUN_ERROR")).toBe(false);
    });

    test("16: forwardedProps.command.resume is inert — never resumes while pending (D-01, Pitfall 6)", async () => {
        const session = await server.request("chatSessions.create", { title: "dc6" });
        const threadId = String(session.conversationId);
        await openDecision(threadId, "run-16a");

        // The legacy channel must do NOTHING: a run carrying forwardedProps.command.resume
        // but NO resume[] is still a plain run → blocked by the pending interrupt.
        const res = await postJson("/api/copilotkit/agent/default/run", {
            ...runInput(threadId, "run-16b", "hello"),
            forwardedProps: { command: { resume: "x" } },
        });
        expect(res.status).toBe(200);
        const frames = parseSseFrames(await res.text());
        expect(frames[frames.length - 1].type).toBe("RUN_ERROR");
        expect(frames[frames.length - 1]).toMatchObject({ code: "THREAD_BUSY" });
    });

    test("17: post-restart resume — a decision paused before a restart is answerable on a fresh server (A2)", async () => {
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-durable-decision-"));
        try {
            // Server A: pause a decision into the durable data dir (JSONL log
            // AND the SQLite DB — durableDb keeps the conversation +
            // waiting_user executions row alive across restarts).
            const serverA = await startServer({ mcpConfig: {}, dataDir: durableDir, durableDb: true });
            const session = await serverA.request("chatSessions.create", { title: "d5" });
            const threadId = String(session.conversationId);
            const runRes = await postJsonOn(serverA.baseUrl, "/api/copilotkit/agent/default/run", runInput(threadId, "run-17a", "__SCRIPT_DECISION__"));
            expect(runRes.status).toBe(200);
            const runFrames = parseSseFrames(await runRes.text());
            const last = runFrames[runFrames.length - 1] as { type?: string; outcome?: { type?: string; interrupts?: { id?: string }[] } };
            expect(last.outcome?.type).toBe("interrupt");
            const interruptId = last.outcome!.interrupts![0]!.id!;
            await serverA.shutdown();

            // Server B: a FRESH process over the SAME durable data dir — the
            // in-memory registry is empty at boot, so the resume must reach
            // the lazy rebuild (get() → ensureOpen).
            const serverB = await startServer({ mcpConfig: {}, dataDir: durableDir, durableDb: true });
            try {
                // Cold connect replays the interrupt card (D-08, Pitfall 7).
                const connectRes = await postJsonOn(serverB.baseUrl, "/api/copilotkit/agent/default/connect", runInput(threadId, "run-connect-17", "hello"));
                expect(connectRes.status).toBe(200);
                const frames = parseSseFrames(await connectRes.text());
                const replayLast = frames[frames.length - 1] as { type?: string; outcome?: { type?: string; interrupts?: { id?: string }[] } };
                expect(replayLast.type).toBe("RUN_FINISHED");
                expect(replayLast.outcome?.type).toBe("interrupt");
                expect(replayLast.outcome?.interrupts?.[0]?.id).toBe(interruptId);

                // Post-restart resume succeeds with continuation frames — the
                // ensureOpen fallback rebuilds the registry from the JSONL
                // tail + the durable waiting_user row (A2).
                const resumeRes = await postJsonOn(serverB.baseUrl, "/api/copilotkit/agent/default/run", resumeInput(threadId, "run-17b", [
                    {
                        interruptId,
                        status: "resolved",
                        payload: {
                            decision: "approved",
                            answers: [{ question: "Choose __DECISION_OPTION__", answer: "A", weight: "medium" }],
                        },
                    },
                ]));
                expect(resumeRes.status).toBe(200);
                const resumeFrames = parseSseFrames(await resumeRes.text());
                expect(resumeFrames.some((f) => f.type === "TEXT_MESSAGE_CONTENT" && f.delta === "Decision received, continuing.")).toBe(true);
                expect(resumeFrames[resumeFrames.length - 1].type).toBe("RUN_FINISHED");
                expect(resumeFrames.some((f) => f.type === "RUN_ERROR")).toBe(false);
            } finally {
                await serverB.shutdown();
            }
        } finally {
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);
});
