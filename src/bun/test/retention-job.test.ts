import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb, seedProjectAndTask, seedChatSession, setupTestConfig } from "./helpers.ts";
import { RetentionJob } from "../jobs/retention-job.ts";
import { createMockWait } from "./support/mock-wait.ts";

let db: Db;
let cleanup: () => void;
let executionId: number;
let conversationId: number;

async function insertExecution(db: Db): Promise<{ executionId: number; conversationId: number }> {
  const seed = await seedProjectAndTask(db, "/test");
  const row = await db.get<{ id: number }>(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES ($1, $2, 'plan', 'plan', 'human-turn', 'completed', 1) RETURNING id",
    [seed.taskId, seed.conversationId],
  );
  return { executionId: row!.id, conversationId: seed.conversationId };
}

async function countRaw(db: Db): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) as n FROM model_raw_messages"))!.n;
}

async function countStreamEvents(db: Db): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) as n FROM stream_events"))!.n;
}

async function seedRawMsg(db: Db, eid: number, createdAt: string): Promise<void> {
  await db.exec(
    `INSERT INTO model_raw_messages (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at)
     VALUES (NULL, $1, 'test', NULL, 0, 'in', 'token', NULL, '{}', $2)`,
    [eid, createdAt],
  );
}

beforeEach(async () => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = await initDb();
  ({ executionId, conversationId } = await insertExecution(db));
});

afterEach(() => {
  cleanup();
});

// ─── RJ-1: raw messages older than 1 day deleted ─────────────────────────────

describe("RetentionJob — RJ-1: raw message pruning", () => {
  it("deletes rows older than 1 day; keeps rows within 1 day", async () => {
    await seedRawMsg(db, executionId, "2000-01-01 00:00:00"); // old
    // Insert a genuinely recent row
    await db.exec(
      `INSERT INTO model_raw_messages (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json)
       VALUES (NULL, $1, 'test', NULL, 1, 'in', 'token', NULL, '{}')`,
      [executionId],
    );

    const job = new RetentionJob(db);
    await job.runNow();

    // The old row is deleted; recent row survives
    const remaining = await db.rows<{ created_at: string }>(
      "SELECT created_at FROM model_raw_messages ORDER BY id ASC",
    );
    expect(remaining.every((r) => r.created_at !== "2000-01-01 00:00:00")).toBe(true);
  });

  it("row with created_at 25 hours ago is deleted", async () => {
    await db.exec(
      `INSERT INTO model_raw_messages (task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at)
       VALUES (NULL, $1, 'test', NULL, 0, 'in', 'token', NULL, '{}', datetime('now', '-25 hours'))`,
      [executionId],
    );
    expect(await countRaw(db)).toBe(1);

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countRaw(db)).toBe(0);
  });
});

// ─── RJ-2: stream events older than 4 hours deleted ──────────────────────────

describe("RetentionJob — RJ-2: stream_events pruning", () => {
  it("deletes stream events older than 4h; keeps recent events", async () => {
    await db.exec(
      `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)
       VALUES ($1, $2, 0, 'blk', 'text_chunk', 'old', NULL, NULL, NULL, datetime('now', '-5 hours'))`,
      [conversationId, executionId],
    );
    await db.exec(
      `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id)
       VALUES ($1, $2, 1, 'blk', 'text_chunk', 'recent', NULL, NULL, NULL)`,
      [conversationId, executionId],
    );

    expect(await countStreamEvents(db)).toBe(2);

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countStreamEvents(db)).toBe(1);
    const row = (await db.get<{ content: string }>("SELECT content FROM stream_events"))!;
    expect(row.content).toBe("recent");
  });
});

// ─── RJ-3: start() triggers immediate runNow + periodic runs on tick ─────────

describe("RetentionJob — RJ-3: start/tick cycle", () => {
  it("start() runs immediately; each tick() triggers another runNow()", async () => {
    const { waitFn, tick } = createMockWait();

    // Wrap db.exec to count DELETE calls
    const originalExec = db.exec.bind(db);
    let deleteCount = 0;
    db.exec = ((...args: Parameters<typeof db.exec>) => {
      const sql = args[0] as string;
      if (sql.startsWith("DELETE")) deleteCount++;
      return originalExec(...args);
    }) as typeof db.exec;

    const job = new RetentionJob(db, waitFn);
    job.start();
    await new Promise((r) => setTimeout(r, 0));
    // runNow() called immediately on start — 3 DELETEs (raw + stream_events + chat_sessions)
    // Conversations DELETE is conditional (only runs when stale sessions exist)
    expect(deleteCount).toBe(3);

    tick();
    await new Promise((r) => setTimeout(r, 0));
    // Another runNow() after tick
    expect(deleteCount).toBe(6);

    job.stop();
    db.exec = originalExec;
  });
});

// ─── RJ-4: stop() halts the loop ─────────────────────────────────────────────

describe("RetentionJob — RJ-4: stop halts loop", () => {
  it("stop() prevents further runNow() calls after tick()", async () => {
    const { waitFn, tick } = createMockWait();

    let deleteCount = 0;
    const originalExec = db.exec.bind(db);
    db.exec = ((...args: Parameters<typeof db.exec>) => {
      const sql = args[0] as string;
      if (sql.startsWith("DELETE")) deleteCount++;
      return originalExec(...args);
    }) as typeof db.exec;

    const job = new RetentionJob(db, waitFn);
    job.start(); // 3 DELETEs from immediate runNow (conditional conversations DELETE not triggered)
    job.stop();

    tick();
    await new Promise((r) => setTimeout(r, 0));

    // No extra DELETEs because loop was stopped
    expect(deleteCount).toBe(3);

    db.exec = originalExec;
  });
});

// ─── RJ-5: archived chat session hard-delete + cascade ───────────────────────

async function countChatSessions(db: Db): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) as n FROM chat_sessions"))!.n;
}

async function countConversationMessages(db: Db): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) as n FROM conversation_messages"))!.n;
}

describe("RetentionJob — RJ-5: archived chat session hard-delete", () => {
  it("RJ-5a: hard-deletes archived session with archived_at > 7 days ago", async () => {
    const { sessionId } = await seedChatSession(db);
    await db.exec(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = $1",
      [sessionId],
    );
    expect(await countChatSessions(db)).toBe(1);

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countChatSessions(db)).toBe(0);
  });

  it("RJ-5b: preserves archived session archived only 3 days ago", async () => {
    const { sessionId } = await seedChatSession(db);
    await db.exec(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-3 days') WHERE id = $1",
      [sessionId],
    );

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countChatSessions(db)).toBe(1);
  });

  it("RJ-5c: never deletes an idle (non-archived) session", async () => {
    await seedChatSession(db);
    // status defaults to 'idle'

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countChatSessions(db)).toBe(1);
  });

  it("RJ-5d: cascade-deletes conversation_messages when session is hard-deleted", async () => {
    const { sessionId, conversationId } = await seedChatSession(db);
    await db.exec(
      "INSERT INTO conversation_messages (conversation_id, type, content) VALUES ($1, 'user', 'hello')",
      [conversationId],
    );
    await db.exec(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = $1",
      [sessionId],
    );
    expect(await countConversationMessages(db)).toBe(1);

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countChatSessions(db)).toBe(0);
    expect(await countConversationMessages(db)).toBe(0);
  });

  it("RJ-5e: cascade-deletes stream_events when session is hard-deleted", async () => {
    const { sessionId, conversationId } = await seedChatSession(db);
    await db.exec(
      `INSERT INTO stream_events (conversation_id, execution_id, seq, block_id, type, content)
       VALUES ($1, 0, 1, 'blk', 'text_chunk', 'data')`,
      [conversationId],
    );
    await db.exec(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = $1",
      [sessionId],
    );

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countChatSessions(db)).toBe(0);
    expect(await countStreamEvents(db)).toBe(0);
  });

  it("RJ-5f: explicitly deletes executions linked to hard-deleted sessions", async () => {
    const { sessionId, conversationId } = await seedChatSession(db);
    await db.exec(
      "INSERT INTO executions (conversation_id, from_state, to_state, status, attempt) VALUES ($1, 'idle', 'idle', 'completed', 1)",
      [conversationId],
    );
    await db.exec(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = $1",
      [sessionId],
    );
    const execCount = async () => (await db.get<{ n: number }>("SELECT COUNT(*) as n FROM executions"))!.n;
    expect(await execCount()).toBe(2); // 1 from beforeEach + 1 for chat session

    const job = new RetentionJob(db);
    await job.runNow();

    expect(await countChatSessions(db)).toBe(0);
    // The chat execution is removed; the task execution from beforeEach remains
    expect(await execCount()).toBe(1);
  });
});
