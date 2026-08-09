/**
 * legacy-import.test.ts — real-wire legacy import e2e (IMPR-01, D-06/D-07/D-08).
 *
 * Spawns the REAL server with a durable dataDir + durable DB (startServer
 * fixture contract — durable DB at join(dataDir, "railyn.db")), seeds legacy
 * `conversations`/`conversation_messages` rows via bun:sqlite, triggers
 * `legacyImport.run` over the RPC wire, and asserts the resulting JSONL log
 * on disk: RUN_STARTED-with-input first, RUN_FINISHED last, naive-UTC
 * timestamps normalized (Pitfall 1), frozen legacy row counts (IMPR-02/D-08),
 * idempotent re-run (D-07/Pitfall 5), threads.list integration, and a
 * restart-replay proof that a fresh server cold-replays the imported thread
 * (criterion 5 — index from log for imported data).
 */
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type TestServer } from "../fixtures/server";

const FIXED_TS = "2026-08-09 08:00:00";
const FIXED_TS_PARSED = Date.parse("2026-08-09T08:00:00Z");

/** Frozen-table read: count conversation_messages rows via a fresh readonly
 * bun:sqlite connection (IMPR-02/D-08 — import must never write these). */
function countMessages(dbPath: string): number {
    const db = new Database(dbPath, { readonly: true });
    try {
        const row = db.query("SELECT COUNT(*) AS n FROM conversation_messages").get() as { n: number };
        return Number(row.n);
    } finally {
        db.close();
    }
}

/** Seed a legacy conversation (task_id NULL → session-kind thread) with a user
 * turn + assistant reply through a SEPARATE write connection, then close it.
 * Returns the conversation id (= the JSONL threadId). */
function seedLegacyConversation(dbPath: string): string {
    const seed = new Database(dbPath);
    try {
        const conv = seed.query("INSERT INTO conversations (task_id) VALUES (NULL)").run();
        const convId = String(conv.lastInsertRowid);
        seed
            .query(
                "INSERT INTO conversation_messages (conversation_id, type, role, content, metadata, created_at) VALUES (?, 'user', 'user', ?, NULL, ?)",
            )
            .run(Number(convId), "fix the build", FIXED_TS);
        seed
            .query(
                "INSERT INTO conversation_messages (conversation_id, type, role, content, metadata, created_at) VALUES (?, 'assistant', 'assistant', ?, NULL, ?)",
            )
            .run(Number(convId), "Looking into it…", "2026-08-09 08:00:05");
        return convId;
    } finally {
        seed.close();
    }
}

/** Raw fetch helper for AG-UI endpoints against an arbitrary server. */
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

describe("legacyImport.run (IMPR-01, D-06/D-07/D-08)", () => {
    test("1: seeded legacy rows import over the wire — JSONL shape, frozen counts, idempotent re-run, threads.list, no .tmp residue", async () => {
        const dataDir = mkdtempSync(join(tmpdir(), "railyn-import-e2e-"));
        const server: TestServer = await startServer({ dataDir, durableDb: true });
        try {
            const dbPath = join(dataDir, "railyn.db");
            const threadId = seedLegacyConversation(dbPath);
            const before = countMessages(dbPath);

            // The import over the real RPC wire.
            const summary = await server.request("legacyImport.run", {});
            expect(summary).toEqual({ total: 1, imported: 1, skipped: 0, failed: 0, errors: [] });

            // JSONL on disk: RUN_STARTED (with the user input) first, RUN_FINISHED last.
            const logPath = join(dataDir, "threads", `${threadId}.jsonl`);
            const lines = readFileSync(logPath, "utf-8").trim().split("\n");
            const first = JSON.parse(lines[0]);
            const last = JSON.parse(lines[lines.length - 1]);
            expect(first.type).toBe("RUN_STARTED");
            expect(first.input?.messages?.[0]).toMatchObject({ role: "user", content: "fix the build" });
            expect(last.type).toBe("RUN_FINISHED");
            expect(last.result).toBeNull();

            // Pitfall 1: naive-UTC timestamps are normalized, not local-shifted.
            expect(first.timestamp).toBe(FIXED_TS_PARSED);

            // The imported thread lists through threads.list (kind session,
            // name null — no chat_sessions row for the seeded conversation).
            const threads = await server.request("threads.list", {});
            const imported = threads.find((t) => t.threadId === threadId);
            expect(imported).toBeDefined();
            expect(imported!.kind).toBe("session");
            expect(imported!.name).toBeNull();

            // Idempotent re-run (D-07, Pitfall 5): nothing duplicated.
            const second = await server.request("legacyImport.run", {});
            expect(second).toEqual({ total: 1, imported: 0, skipped: 1, failed: 0, errors: [] });

            // No *.jsonl.tmp residue from the atomic write.
            expect(readdirSync(join(dataDir, "threads")).filter((f) => f.endsWith(".tmp"))).toEqual([]);

            // Frozen tables (IMPR-02, D-08): the count is identical after the import.
            expect(countMessages(dbPath)).toBe(before);
        } finally {
            await server.shutdown();
            rmSync(dataDir, { recursive: true, force: true });
        }
    }, 30_000);

    test("2: restart replay — a fresh server over the same durable dataDir cold-replays the imported thread (criterion 5)", async () => {
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-import-durable-"));
        try {
            // Server A: seed + import over the real wire.
            const serverA: TestServer = await startServer({ dataDir: durableDir, durableDb: true });
            let threadId: string;
            try {
                threadId = seedLegacyConversation(join(durableDir, "railyn.db"));
                const summary = await serverA.request("legacyImport.run", {});
                expect(summary.imported).toBe(1);
            } finally {
                await serverA.shutdown();
            }

            // Server B: a FRESH process over the SAME dataDir — the in-memory
            // thread store is empty, so connect cold-replays the imported JSONL
            // (index rebuilt from the log — criterion 5 for imported data).
            const serverB: TestServer = await startServer({ dataDir: durableDir, durableDb: true });
            try {
                const res = await postJsonOn(
                    serverB.baseUrl,
                    "/api/copilotkit/agent/default/connect",
                    runInput(threadId, "run-connect", "hello"),
                );
                expect(res.status).toBe(200);
                const frames = parseSseFrames(await res.text());
                expect(frames.length).toBeGreaterThan(0);
                expect(frames[0].type).toBe("RUN_STARTED");
                expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");

                // The index rebuilt from the log lists the imported thread.
                const threads = await serverB.request("threads.list", {});
                expect(threads.some((t) => t.threadId === threadId)).toBe(true);
            } finally {
                await serverB.shutdown();
            }
        } finally {
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);
});

describe("crash tolerance (criterion 5)", () => {
    test("A: a partial trailing line (interrupted append, A1) neither hides the thread from the index nor breaks cold replay — the complete lines replay, the partial line is skipped", async () => {
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-crash-a-"));
        try {
            // Server A: seed + import, then simulate a runner that died mid-append
            // (assumption A1): a truncated JSON line with NO trailing newline at
            // the very end of the log — the tolerant reader must skip it.
            const serverA: TestServer = await startServer({ dataDir: durableDir, durableDb: true });
            let threadId: string;
            try {
                threadId = seedLegacyConversation(join(durableDir, "railyn.db"));
                const summary = await serverA.request("legacyImport.run", {});
                expect(summary.imported).toBe(1);

                appendFileSync(
                    join(durableDir, "threads", `${threadId}.jsonl`),
                    '{"type":"RUN_STARTED","threadId":',
                    "utf-8",
                );

                // Half 1 of criterion 5 — the index rebuilds from the log: the
                // corrupted thread STILL lists (list() is content-agnostic and
                // THREAD_ID_RE-filtered; a bad tail cannot hide the file).
                const threads = await serverA.request("threads.list", {});
                expect(threads.some((t) => t.threadId === threadId)).toBe(true);
            } finally {
                await serverA.shutdown();
            }

            // Server B: a FRESH process over the SAME dataDir — cold connect must
            // replay the COMPLETE imported lines and skip the partial tail
            // (half 2 of criterion 5 — tolerant read across a restart).
            const serverB: TestServer = await startServer({ dataDir: durableDir, durableDb: true });
            try {
                const res = await postJsonOn(
                    serverB.baseUrl,
                    "/api/copilotkit/agent/default/connect",
                    runInput(threadId, "run-connect-crash", "hello"),
                );
                expect(res.status).toBe(200);
                const frames = parseSseFrames(await res.text());
                expect(frames.length).toBeGreaterThan(0);
                const started = frames[0] as {
                    type: string;
                    input?: { messages: Array<{ role: string; content: string }> };
                };
                expect(started.type).toBe("RUN_STARTED");
                // The COMPLETE lines replayed: the imported user turn is present,
                // and the truncated tail contributed no frame (parseSseFrames
                // would have failed on a malformed one).
                expect(
                    started.input?.messages?.some((m) => m.role === "user" && m.content === "fix the build"),
                ).toBe(true);
                expect(frames[frames.length - 1].type).toBe("RUN_FINISHED");

                // The fresh server also lists the thread — the index rebuilt from
                // the corrupted log on disk.
                const threads = await serverB.request("threads.list", {});
                expect(threads.some((t) => t.threadId === threadId)).toBe(true);
            } finally {
                await serverB.shutdown();
            }
        } finally {
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);

    test("B: a *.jsonl.tmp crash artifact is invisible — list() omits it, the imported entry is unchanged, and re-import still skips via the FINAL file marker", async () => {
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-crash-b-"));
        const server: TestServer = await startServer({ dataDir: durableDir, durableDb: true });
        try {
            const threadId = seedLegacyConversation(join(durableDir, "railyn.db"));
            const summary = await server.request("legacyImport.run", {});
            expect(summary.imported).toBe(1);

            // A crashed whole-file import (Pattern 2) leaves its write at
            // {id}.jsonl.tmp — the decoy next to the real thread file.
            writeFileSync(
                join(durableDir, "threads", `${threadId}.jsonl.tmp`),
                '{"type":"RUN_STARTED","threadId":1}\n',
                "utf-8",
            );

            // list() skips the decoy by construction (THREAD_ID_RE + .jsonl
            // filter) — the list is exactly the imported thread, unchanged.
            const threads = await server.request("threads.list", {});
            expect(threads).toHaveLength(1);
            expect(threads[0].threadId).toBe(threadId);

            // exists() semantics unchanged: the FINAL file, not the .tmp, is the
            // D-07 marker — the re-import still reports the thread as skipped.
            const second = await server.request("legacyImport.run", {});
            expect(second).toEqual({ total: 1, imported: 0, skipped: 1, failed: 0, errors: [] });
        } finally {
            await server.shutdown();
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);

    test("C: re-import after a simulated crash (partial tail) stays skipped — the crash artifact cannot fool the D-07 marker", async () => {
        // Self-contained (WR-05): creates its own crash artifact — a final file
        // with a partial tail — instead of reusing another test's side effects.
        const durableDir = mkdtempSync(join(tmpdir(), "railyn-crash-c-"));
        const serverC: TestServer = await startServer({ dataDir: durableDir, durableDb: true });
        try {
            const threadId = seedLegacyConversation(join(durableDir, "railyn.db"));
            const first = await serverC.request("legacyImport.run", {});
            expect(first).toEqual({ total: 1, imported: 1, skipped: 0, failed: 0, errors: [] });

            // Simulate the crash artifact: a truncated trailing JSON line.
            appendFileSync(
                join(durableDir, "threads", `${threadId}.jsonl`),
                '{"type":"RUN_STARTED","threadId":',
                "utf-8",
            );

            // The final file (present but with a partial tail) is still the
            // honest idempotency marker, and a re-import writes nothing (no
            // .tmp residue from the re-run either).
            const second = await serverC.request("legacyImport.run", {});
            expect(second).toEqual({ total: 1, imported: 0, skipped: 1, failed: 0, errors: [] });
            expect(readdirSync(join(durableDir, "threads")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
        } finally {
            await serverC.shutdown();
            rmSync(durableDir, { recursive: true, force: true });
        }
    }, 30_000);
});
