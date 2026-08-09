/**
 * threads.test.ts — real-wire tests for the `threads.list` RPC (CHAT-08, D-01/D-02).
 *
 * Spawns the REAL server (mock engine) and proves the authoritative-index
 * property (D-01, Pitfall 3): the listing comes from the JSONL dir on disk,
 * NOT the runtime's in-memory `GET /threads`. Suite A lists a standalone
 * session and a card conversation after a real run; Suite B restarts the
 * server over the same durable dataDir and asserts the same thread comes
 * back from disk on a FRESH process.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type TestServer } from "../fixtures/server";

let server: TestServer;

/** Raw fetch helper for AG-UI endpoints (not part of RailynAPI). */
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

/** Run one text turn to completion on a thread (persists the JSONL log). */
async function runTurn(baseUrl: string, threadId: string, runId: string): Promise<void> {
    const res = await postJsonOn(baseUrl, "/api/copilotkit/agent/default/run", runInput(threadId, runId, "hello"));
    expect(res.status).toBe(200);
    const frames = parseSseFrames(await res.text());
    expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");
}

describe("threads.list real wire (CHAT-08, D-01/D-02)", () => {
    beforeAll(async () => {
        // mcpConfig: {} populates server.dataDir so runs persist under
        // <dataDir>/threads/{conversationId}.jsonl — the listing's source.
        server = await startServer({ mcpConfig: {} });
    }, 20_000);

    afterAll(async () => {
        if (server) {
            await server.shutdown();
        }
    });

    test("session thread: chatSessions.create + run → listed kind 'session' with the chat title", async () => {
        const session = await server.request("chatSessions.create", { title: "sess-a" });
        const threadId = String(session.conversationId);
        await runTurn(server.baseUrl, threadId, "run-t1");

        const threads = await server.request("threads.list", {});
        const entry = threads.find((t) => t.threadId === threadId);
        expect(entry).toBeDefined();
        expect(entry!.kind).toBe("session");
        expect(entry!.name).toBe("sess-a");
    });

    test("card thread: boards.list → tasks.create + run → listed kind 'card' with the task title", async () => {
        const boards = await server.request("boards.list", {});
        expect(boards.length).toBeGreaterThan(0);
        const board = boards[0];

        const task = await server.request("tasks.create", {
            boardId: board.id,
            projectKey: "test-ws",
            title: "Card Alpha",
            description: "Card from the thread-index e2e",
        });
        const threadId = String(task.conversationId);
        await runTurn(server.baseUrl, threadId, "run-t2");

        const threads = await server.request("threads.list", {});
        const entry = threads.find((t) => t.threadId === threadId);
        expect(entry).toBeDefined();
        expect(entry!.kind).toBe("card");
        expect(entry!.name).toBe("Card Alpha");
    });

    test("restart proof: a fresh server over the same durable dataDir lists the same thread from disk (Pitfall 3)", async () => {
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-threads-durable-"));
        try {
            // Server A: create a session and run one turn into the durable dir.
            const serverA = await startServer({ mcpConfig: {}, dataDir: durableDir, durableDb: true });
            const session = await serverA.request("chatSessions.create", { title: "sess-b" });
            const threadId = String(session.conversationId);
            await runTurn(serverA.baseUrl, threadId, "run-t3a");
            const before = await serverA.request("threads.list", {});
            expect(before.some((t) => t.threadId === threadId && t.kind === "session" && t.name === "sess-b")).toBe(true);
            await serverA.shutdown();

            // Server B: FRESH process over the SAME data dir — the runtime's
            // in-memory thread store is empty, so the listing must come from
            // the JSONL dir (the log IS the index).
            const serverB = await startServer({ mcpConfig: {}, dataDir: durableDir, durableDb: true });
            try {
                const after = await serverB.request("threads.list", {});
                expect(after.length).toBeGreaterThan(0);
                const entry = after.find((t) => t.threadId === threadId);
                expect(entry).toBeDefined();
                expect(entry!.kind).toBe("session");
                expect(entry!.name).toBe("sess-b");
            } finally {
                await serverB.shutdown();
            }
        } finally {
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);
});
