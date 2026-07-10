import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initDb, seedProjectAndTask, seedChatSession, setupTestConfig } from "./helpers.ts";
import { RetentionJob } from "../jobs/retention-job.ts";
import type { ConversationFileDeleter } from "../conversation/conversation-file-deleter.ts";
import { createMockWait } from "./support/mock-wait.ts";

let db: Database;
let cleanup: () => void;
let executionId: number;
let conversationId: number;
let debugLogDir: string;

function insertExecution(db: Database): { executionId: number; conversationId: number } {
  const seed = seedProjectAndTask(db, "/test");
  db.run(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, ?, 'plan', 'plan', 'human-turn', 'completed', 1)",
    [seed.taskId, seed.conversationId],
  );
  const eid = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
  return { executionId: eid, conversationId: seed.conversationId };
}

/** Writes a debug-log file with a given mtime, mirroring `<conversationId>.debug.<executionId>.jsonl`. */
function seedDebugLogFile(convId: number, execId: number, ageMs: number): string {
  const path = join(debugLogDir, `${convId}.debug.${execId}.jsonl`);
  writeFileSync(path, `${JSON.stringify({ eventType: "token" })}\n`, "utf-8");
  const mtime = new Date(Date.now() - ageMs);
  utimesSync(path, mtime, mtime);
  return path;
}

beforeEach(() => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = initDb();
  ({ executionId, conversationId } = insertExecution(db));
  debugLogDir = mkdtempSync(join(tmpdir(), "railyn-debug-logs-"));
});

afterEach(() => {
  cleanup();
  rmSync(debugLogDir, { recursive: true, force: true });
});

// ─── RJ-1: debug-log files older than 1 day deleted ──────────────────────────

describe("RetentionJob — RJ-1: raw-message debug-log pruning", () => {
  it("deletes debug-log files older than 1 day; keeps files within 1 day", async () => {
    const oldPath = seedDebugLogFile(conversationId, executionId, 25 * 60 * 60_000);
    const recentPath = seedDebugLogFile(conversationId, executionId + 1, 1000);

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(recentPath)).toBe(true);
  });

  it("file with mtime 25 hours ago is deleted", async () => {
    const path = seedDebugLogFile(conversationId, executionId, 25 * 60 * 60_000);
    expect(existsSync(path)).toBe(true);

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(existsSync(path)).toBe(false);
  });

  it("non-debug-log files in the same directory are left untouched", async () => {
    const unrelatedPath = join(debugLogDir, `${conversationId}.jsonl`);
    writeFileSync(unrelatedPath, "{}\n", "utf-8");
    const mtime = new Date(Date.now() - 25 * 60 * 60_000);
    utimesSync(unrelatedPath, mtime, mtime);

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(existsSync(unrelatedPath)).toBe(true);
  });
});


// ─── RJ-3: start() triggers immediate runNow + periodic runs on tick ─────────

describe("RetentionJob — RJ-3: start/tick cycle", () => {
  it("start() runs immediately; each tick() triggers another runNow()", async () => {
    const { waitFn, tick } = createMockWait();

    // Wrap db.run to count DELETE calls
    const originalRun = db.run.bind(db);
    let deleteCount = 0;
    db.run = (...args: Parameters<typeof db.run>) => {
      const sql = args[0] as string;
      if (sql.startsWith("DELETE")) deleteCount++;
      return originalRun(...args);
    };

    const job = new RetentionJob(db, waitFn, debugLogDir);
    job.start();
    // runNow() is async (debug-log pruning awaits fs I/O first) — flush a macrotask so its
    // SQL DELETE (chat_sessions; conversations DELETE is conditional) lands.
    await new Promise((r) => setTimeout(r, 0));
    expect(deleteCount).toBe(1);

    tick();
    await new Promise((r) => setTimeout(r, 0));
    // Another runNow() after tick
    expect(deleteCount).toBe(2);

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

    const job = new RetentionJob(db, waitFn, debugLogDir);
    job.start(); // 1 DELETE from immediate runNow (conditional conversations DELETE not triggered)
    await new Promise((r) => setTimeout(r, 0));
    job.stop();

    tick();
    await new Promise((r) => setTimeout(r, 0));

    // No extra DELETEs because loop was stopped
    expect(deleteCount).toBe(1);

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
  it("RJ-5a: hard-deletes archived session with archived_at > 7 days ago", async () => {
    const { sessionId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );
    expect(countChatSessions(db)).toBe(1);

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(countChatSessions(db)).toBe(0);
  });

  it("RJ-5b: preserves archived session archived only 3 days ago", async () => {
    const { sessionId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-3 days') WHERE id = ?",
      [sessionId],
    );

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(countChatSessions(db)).toBe(1);
  });

  it("RJ-5c: never deletes an idle (non-archived) session", async () => {
    seedChatSession(db);
    // status defaults to 'idle'

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(countChatSessions(db)).toBe(1);
  });

  it("RJ-5d: cascade-deletes conversation_messages when session is hard-deleted", async () => {
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

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(countChatSessions(db)).toBe(0);
    expect(countConversationMessages(db)).toBe(0);
  });

  it("RJ-5f: explicitly deletes executions linked to hard-deleted sessions", async () => {
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

    const job = new RetentionJob(db, undefined, debugLogDir);
    await job.runNow();

    expect(countChatSessions(db)).toBe(0);
    // The chat execution is removed; the task execution from beforeEach remains
    expect(execCount()).toBe(1);
  });

  it("RJ-5g: calls the injected ConversationFileDeleter for each hard-deleted session's conversation, after the SQL cascade commits", async () => {
    const { sessionId, conversationId } = seedChatSession(db);
    db.run(
      "UPDATE chat_sessions SET status = 'archived', archived_at = datetime('now', '-8 days') WHERE id = ?",
      [sessionId],
    );

    const deletedIds: number[] = [];
    const fakeDeleter: ConversationFileDeleter = {
      deleteConversationFiles: async (id) => {
        // The SQL cascade must already be committed by the time this is called.
        expect(countChatSessions(db)).toBe(0);
        deletedIds.push(id);
      },
    };

    const job = new RetentionJob(db, undefined, debugLogDir, fakeDeleter);
    await job.runNow();

    expect(deletedIds).toEqual([conversationId]);
  });

  it("RJ-5h: does not call the ConversationFileDeleter when no session is stale", async () => {
    seedChatSession(db);
    // status defaults to 'idle' — nothing stale to sweep.

    const deletedIds: number[] = [];
    const fakeDeleter: ConversationFileDeleter = {
      deleteConversationFiles: async (id) => {
        deletedIds.push(id);
      },
    };

    const job = new RetentionJob(db, undefined, debugLogDir, fakeDeleter);
    await job.runNow();

    expect(deletedIds).toEqual([]);
  });
});
