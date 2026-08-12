import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, seedChatSession, setupTestConfig } from "./helpers.ts";
import { RetentionJob } from "../jobs/retention-job.ts";
import { createMockWait } from "./support/mock-wait.ts";

let db: Database;
let cleanup: () => void;
let executionId: number;
let conversationId: number;

function insertExecution(db: Database): { executionId: number; conversationId: number } {
  const seed = seedProjectAndTask(db, "/test");
  db.run(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, ?, 'plan', 'plan', 'human-turn', 'completed', 1)",
    [seed.taskId, seed.conversationId],
  );
  const eid = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
  return { executionId: eid, conversationId: seed.conversationId };
}

function countStreamEvents(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM stream_events").get()!.n;
}

beforeEach(() => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = initDb();
  ({ executionId, conversationId } = insertExecution(db));
});

afterEach(() => {
  cleanup();
});

// ─── RJ-1: stream events older than 4 hours deleted (batched) ────────────────

describe("RetentionJob — RJ-1: stream_events pruning", () => {
  it("deletes stream events older than 4h; keeps recent events", () => {
    db.run(
      `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)
       VALUES (?, ?, 0, 'blk', 'text_chunk', 'old', NULL, NULL, NULL, datetime('now', '-5 hours'))`,
      [conversationId, executionId],
    );
    db.run(
      `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)
       VALUES (?, ?, 1, 'blk', 'text_chunk', 'recent', NULL, NULL, NULL)`,
      [conversationId, executionId],
    );

    expect(countStreamEvents(db)).toBe(2);

    const job = new RetentionJob(db);
    job.runNow();

    expect(countStreamEvents(db)).toBe(1);
    const row = db.query<{ content: string }, []>("SELECT content FROM stream_events").get()!;
    expect(row.content).toBe("recent");
  });

  it("deletes stale rows in short auto-commit batches", () => {
    for (let i = 0; i < 1200; i++) {
      db.run(
        `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, created_at)
         VALUES (?, ?, ?, 'blk', 'text_chunk', 'old', datetime('now', '-5 hours'))`,
        [conversationId, executionId, i],
      );
    }
    expect(countStreamEvents(db)).toBe(1200);

    // Count DELETE statements issued for stream_events — 1200 rows / 500 per
    // batch means at least 3 separate auto-commit statements, never one giant
    // transaction.
    const originalRun = db.run.bind(db);
    let streamDeleteCalls = 0;
    db.run = (...args: Parameters<typeof db.run>) => {
      const sql = args[0] as string;
      if (sql.includes("FROM stream_events")) streamDeleteCalls++;
      return originalRun(...args);
    };

    const job = new RetentionJob(db);
    job.runNow();

    db.run = originalRun;
    expect(countStreamEvents(db)).toBe(0);
    expect(streamDeleteCalls).toBeGreaterThanOrEqual(3);
  });

  it("does not reference the dropped model_raw_messages table", () => {
    const originalRun = db.run.bind(db);
    const referenced: string[] = [];
    db.run = (...args: Parameters<typeof db.run>) => {
      referenced.push(String(args[0]));
      return originalRun(...args);
    };

    const job = new RetentionJob(db);
    job.runNow();

    db.run = originalRun;
    expect(referenced.some((sql) => sql.includes("model_raw_messages"))).toBe(false);
  });

  it("one phase failing does not abort the job", () => {
    const { sessionId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );
    expect(countChatSessions(db)).toBe(1);

    // The first stream_events DELETE throws SQLITE_BUSY — that phase is
    // aborted, but the archived-chat cleanup phase still runs.
    const originalRun = db.run.bind(db);
    let streamDeleteCalls = 0;
    db.run = (...args: Parameters<typeof db.run>) => {
      const sql = args[0] as string;
      if (sql.includes("FROM stream_events")) {
        streamDeleteCalls++;
        if (streamDeleteCalls === 1) {
          const err = new Error("database is locked") as Error & { code: string };
          err.code = "SQLITE_BUSY";
          throw err;
        }
      }
      return originalRun(...args);
    };

    const job = new RetentionJob(db);
    job.runNow();

    db.run = originalRun;
    expect(countChatSessions(db)).toBe(0); // second phase still executed
  });
});

// ─── RJ-2: start() defers the first run; loop is tick-driven ─────────────────

describe("RetentionJob — RJ-2: start/tick cycle", () => {
  function countDeletes(): { count: () => number; restore: () => void } {
    const originalRun = db.run.bind(db);
    let deleteCount = 0;
    db.run = (...args: Parameters<typeof db.run>) => {
      const sql = args[0] as string;
      if (sql.startsWith("DELETE")) deleteCount++;
      return originalRun(...args);
    };
    return { count: () => deleteCount, restore: () => { db.run = originalRun; } };
  }

  it("start() defers the first cleanup until the initial delay elapses", async () => {
    const { waitFn, tick } = createMockWait();
    const del = countDeletes();

    const job = new RetentionJob(db, waitFn);
    job.start();
    // Deferred: nothing runs synchronously at startup
    expect(del.count()).toBe(0);

    tick(); // initial delay elapses → first runNow
    await new Promise((r) => setTimeout(r, 0));
    expect(del.count()).toBe(2); // stream_events + chat_sessions DELETEs

    tick(); // hourly tick → second runNow
    await new Promise((r) => setTimeout(r, 0));
    expect(del.count()).toBe(4);

    job.stop();
    del.restore();
  });

  it("stop() prevents further cleanups after the current run", async () => {
    const { waitFn, tick } = createMockWait();
    const del = countDeletes();

    const job = new RetentionJob(db, waitFn);
    job.start();
    tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(del.count()).toBe(2);

    job.stop();
    tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(del.count()).toBe(2); // no extra runs after stop

    del.restore();
  });
});

// ─── RJ-3: archived chat session hard-delete + cascade ───────────────────────

function countChatSessions(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM chat_sessions").get()!.n;
}

function countConversationMessages(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM conversation_messages").get()!.n;
}

describe("RetentionJob — RJ-3: archived chat session hard-delete", () => {
  it("RJ-3a: hard-deletes archived session with archived_at > 7 days ago", () => {
    const { sessionId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );
    expect(countChatSessions(db)).toBe(1);

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(0);
  });

  it("RJ-3b: preserves archived session archived only 3 days ago", () => {
    const { sessionId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-3 days') WHERE id = ?",
      [sessionId],
    );

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(1);
  });

  it("RJ-3c: never deletes an idle (non-archived) session", () => {
    seedChatSession(db);
    // status defaults to 'idle'

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(1);
  });

  it("RJ-3d: cascade-deletes conversation_messages when session is hard-deleted", () => {
    const { sessionId, conversationId } = seedChatSession(db);
    db.run(
      "INSERT INTO conversation_messages (conversation_id, type, content) VALUES (?, 'user', 'hello')",
      [conversationId],
    );
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );
    expect(countConversationMessages(db)).toBe(1);

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(0);
    expect(countConversationMessages(db)).toBe(0);
  });

  it("RJ-3e: cascade-deletes stream_events when session is hard-deleted", () => {
    const { sessionId, conversationId } = seedChatSession(db);
    db.run(
      `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content)
       VALUES (?, 0, 1, 'blk', 'text_chunk', 'data')`,
      [conversationId],
    );
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(0);
    expect(countStreamEvents(db)).toBe(0);
  });

  it("RJ-3f: explicitly deletes executions linked to hard-deleted sessions", () => {
    const { sessionId, conversationId } = seedChatSession(db);
    db.run(
      "INSERT INTO executions (conversation_id, from_state, to_state, status, attempt) VALUES (?, 'idle', 'idle', 'completed', 1)",
      [conversationId],
    );
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );
    const execCount = () => db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM executions").get()!.n;
    expect(execCount()).toBe(2); // 1 from beforeEach + 1 for chat session

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(0);
    // The chat execution is removed; the task execution from beforeEach remains
    expect(execCount()).toBe(1);
  });
});
