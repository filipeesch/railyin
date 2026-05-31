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

function countRaw(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM model_raw_messages").get()!.n;
}

function countStreamEvents(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM stream_events").get()!.n;
}

function seedRawMsg(db: Database, eid: number, createdAt: string): void {
  db.run(
    `INSERT INTO model_raw_messages (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at)
     VALUES (NULL, ?, 'test', NULL, 0, 'in', 'token', NULL, '{}', ?)`,
    [eid, createdAt],
  );
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

// ─── RJ-1: raw messages older than 1 day deleted ─────────────────────────────

describe("RetentionJob — RJ-1: raw message pruning", () => {
  it("deletes rows older than 1 day; keeps rows within 1 day", () => {
    seedRawMsg(db, executionId, "2000-01-01 00:00:00"); // old
    // Insert a genuinely recent row
    db.run(
      `INSERT INTO model_raw_messages (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
       VALUES (NULL, ?, 'test', NULL, 1, 'in', 'token', NULL, '{}')`,
      [executionId],
    );

    const job = new RetentionJob(db);
    job.runNow();

    // The old row is deleted; recent row survives
    const remaining = db
      .query<{ created_at: string }, []>("SELECT created_at FROM model_raw_messages ORDER BY id ASC")
      .all();
    expect(remaining.every((r) => r.created_at !== "2000-01-01 00:00:00")).toBe(true);
  });

  it("row with created_at 25 hours ago is deleted", () => {
    db.run(
      `INSERT INTO model_raw_messages (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at)
       VALUES (NULL, ?, 'test', NULL, 0, 'in', 'token', NULL, '{}', datetime('now', '-25 hours'))`,
      [executionId],
    );
    expect(countRaw(db)).toBe(1);

    const job = new RetentionJob(db);
    job.runNow();

    expect(countRaw(db)).toBe(0);
  });
});

// ─── RJ-2: stream events older than 4 hours deleted ──────────────────────────

describe("RetentionJob — RJ-2: stream_events pruning", () => {
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
});

// ─── RJ-3: start() triggers immediate runNow + periodic runs on tick ─────────

describe("RetentionJob — RJ-3: start/tick cycle", () => {
  it("start() runs immediately; each tick() triggers another runNow()", async () => {
    const { waitFn, tick } = createMockWait();

    let runCount = 0;
    // Wrap db.run to count DELETE calls
    const originalRun = db.run.bind(db);
    let deleteCount = 0;
    db.run = (...args: Parameters<typeof db.run>) => {
      const sql = args[0] as string;
      if (sql.startsWith("DELETE")) deleteCount++;
      return originalRun(...args);
    };

    const job = new RetentionJob(db, waitFn);
    job.start();
    // runNow() called immediately on start — 3 DELETEs (raw + stream_events + chat_sessions)
    // Conversations DELETE is conditional (only runs when stale sessions exist)
    expect(deleteCount).toBe(3);

    tick();
    await new Promise((r) => setTimeout(r, 0));
    // Another runNow() after tick
    expect(deleteCount).toBe(6);

    job.stop();
    db.run = originalRun;
  });
});

// ─── RJ-4: stop() halts the loop ─────────────────────────────────────────────

describe("RetentionJob — RJ-4: stop halts loop", () => {
  it("stop() prevents further runNow() calls after tick()", async () => {
    const { waitFn, tick } = createMockWait();

    let deleteCount = 0;
    const originalRun = db.run.bind(db);
    db.run = (...args: Parameters<typeof db.run>) => {
      const sql = args[0] as string;
      if (sql.startsWith("DELETE")) deleteCount++;
      return originalRun(...args);
    };

    const job = new RetentionJob(db, waitFn);
    job.start(); // 3 DELETEs from immediate runNow (conditional conversations DELETE not triggered)
    job.stop();

    tick();
    await new Promise((r) => setTimeout(r, 0));

    // No extra DELETEs because loop was stopped
    expect(deleteCount).toBe(3);

    db.run = originalRun;
  });
});

// ─── RJ-5: archived chat session hard-delete + cascade ───────────────────────

function countChatSessions(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM chat_sessions").get()!.n;
}

function countConversationMessages(db: Database): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM conversation_messages").get()!.n;
}

describe("RetentionJob — RJ-5: archived chat session hard-delete", () => {
  it("RJ-5a: hard-deletes archived session with archived_at > 7 days ago", () => {
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

  it("RJ-5b: preserves archived session archived only 3 days ago", () => {
    const { sessionId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-3 days') WHERE id = ?",
      [sessionId],
    );

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(1);
  });

  it("RJ-5c: never deletes an idle (non-archived) session", () => {
    seedChatSession(db);
    // status defaults to 'idle'

    const job = new RetentionJob(db);
    job.runNow();

    expect(countChatSessions(db)).toBe(1);
  });

  it("RJ-5d: cascade-deletes conversation_messages when session is hard-deleted", () => {
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

  it("RJ-5e: cascade-deletes stream_events when session is hard-deleted", () => {
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
});
