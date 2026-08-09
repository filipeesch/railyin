/**
 * threads-handlers.test.ts — unit tests for the threads.list RPC handler
 * (CHAT-08, D-01/D-02). Direct factory invocation (no HTTP): initDb +
 * makeTempDir + seeded thread files, then threadHandlers(db, store)
 * ["threads.list"](). Pins the DB-enrichment rules: kind via
 * conversations.task_id, name via tasks.title / chat_sessions.title,
 * timestamps via DB columns with file birthtime/mtime fallback, orphan
 * files (no DB row) still listed, empty store → [].
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import type { Database } from "bun:sqlite";
import { initDb, makeTempDir, seedChatSession, seedProjectAndTask } from "./helpers.ts";
import { threadHandlers } from "../handlers/threads.ts";
import { JsonlStore, threadLogPath } from "../copilotkit/jsonl-store.ts";

let db: Database;
let tmp: { dir: string; cleanup: () => void };

beforeEach(() => {
  db = initDb();
  tmp = makeTempDir();
});

afterEach(() => {
  tmp.cleanup();
});

describe("threads.list handler", () => {
  it("5: card and session threads get kind/name/timestamps from the DB join", async () => {
    // Direct writes (unlike store.append) need the threads dir to exist.
    mkdirSync(join(tmp.dir, "threads"), { recursive: true });
    const task = seedProjectAndTask(db, tmp.dir); // card — tasks.title 'Test task'
    const session = seedChatSession(db, { title: "My Session" }); // session — chat_sessions.title

    writeFileSync(threadLogPath(tmp.dir, String(task.conversationId)), '{"type":"RUN_STARTED"}\n', "utf-8");
    writeFileSync(threadLogPath(tmp.dir, String(session.conversationId)), '{"type":"RUN_STARTED"}\n', "utf-8");

    const handlers = threadHandlers(db, new JsonlStore(tmp.dir));
    const threads = await handlers["threads.list"]();

    const card = threads.find((t) => t.threadId === String(task.conversationId));
    expect(card).toBeDefined();
    expect(card!.kind).toBe("card");
    expect(card!.name).toBe("Test task");

    const sess = threads.find((t) => t.threadId === String(session.conversationId));
    expect(sess).toBeDefined();
    expect(sess!.kind).toBe("session");
    expect(sess!.name).toBe("My Session");

    // Timestamps flow from the DB when present (raw SQLite datetime strings).
    const taskCreated = db
      .query<{ created_at: string }, [number]>("SELECT created_at FROM tasks WHERE conversation_id = ?")
      .get(task.conversationId)!;
    expect(card!.createdAt).toBe(taskCreated.created_at);

    const sessCreated = db
      .query<{ created_at: string }, [number]>("SELECT created_at FROM chat_sessions WHERE conversation_id = ?")
      .get(session.conversationId)!;
    const sessActivity = db
      .query<{ last_activity_at: string }, [number]>("SELECT last_activity_at FROM chat_sessions WHERE conversation_id = ?")
      .get(session.conversationId)!;
    expect(sess!.createdAt).toBe(sessCreated.created_at);
    expect(sess!.updatedAt).toBe(sessActivity.last_activity_at);
  });

  it("6: orphan JSONL file with no DB row → kind 'session', name null, file-derived timestamps", async () => {
    mkdirSync(join(tmp.dir, "threads"), { recursive: true });
    const threadId = "777";
    writeFileSync(threadLogPath(tmp.dir, threadId), '{"type":"RUN_STARTED"}\n', "utf-8");

    const handlers = threadHandlers(db, new JsonlStore(tmp.dir));
    const threads = await handlers["threads.list"]();

    expect(threads).toHaveLength(1);
    const entry = threads[0];
    expect(entry.threadId).toBe(threadId);
    expect(entry.kind).toBe("session");
    expect(entry.name).toBeNull();

    // Timestamps are file-derived (birthtime/mtime) — same computation as the handler.
    const st = statSync(threadLogPath(tmp.dir, threadId));
    expect(entry.createdAt).toBe(new Date(st.birthtimeMs ?? st.mtimeMs).toISOString());
    expect(entry.updatedAt).toBe(new Date(st.mtimeMs).toISOString());
  });

  it("7: empty store → []", async () => {
    const handlers = threadHandlers(db, new JsonlStore(tmp.dir));
    expect(await handlers["threads.list"]()).toEqual([]);
  });
});
