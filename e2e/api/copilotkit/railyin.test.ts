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
import { startServer, type TestServer } from "../fixtures/server";

let server: TestServer;

beforeAll(async () => {
    server = await startServer({}); // no copilotkitProbe — the REAL agent registers
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
});
