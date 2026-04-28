import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { ContextEstimator } from "../conversation/context-estimator.ts";

const MAX = 100_000;

let db: Database;
let taskId: number;
let conversationId: number;
let cleanup: () => void;

function insertExecution(db: Database, cid: number, inputTokens: number | null, status = "completed"): number {
  db.run(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt, input_tokens) VALUES (1, ?, 'plan', 'plan', 'human-turn', ?, 1, ?)",
    [cid, status, inputTokens],
  );
  return (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
}

function insertMsg(db: Database, cid: number, type: string, content: string, afterId?: number): void {
  db.run(
    "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (1, ?, ?, 'user', ?)",
    [cid, type, content],
  );
}

beforeEach(() => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test");
  taskId = seed.taskId;
  conversationId = seed.conversationId;
});

afterEach(() => {
  cleanup();
});

// ─── CE-1: fast path — completed execution input_tokens ──────────────────────

describe("ContextEstimator — CE-1: fast path", () => {
  it("returns input_tokens from the most recent completed execution", () => {
    insertExecution(db, conversationId, 50_000);
    const est = new ContextEstimator(db);
    const result = est.estimate(conversationId, MAX);
    expect(result.usedTokens).toBe(50_000);
    expect(result.maxTokens).toBe(MAX);
    expect(result.fraction).toBeCloseTo(0.5);
  });

  it("ignores running executions (uses completed only)", () => {
    insertExecution(db, conversationId, 80_000, "running");
    const est = new ContextEstimator(db);
    const result = est.estimate(conversationId, MAX);
    // No completed execution → slow path, conversation is empty → overhead constant only
    expect(result.usedTokens).toBeLessThan(80_000);
  });
});

// ─── CE-2: slow path — compaction anchor ─────────────────────────────────────

describe("ContextEstimator — CE-2: slow path with anchor", () => {
  it("counts messages after the last compaction_summary anchor", () => {
    insertMsg(db, conversationId, "assistant", "A".repeat(400)); // before anchor
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (1, ?, 'compaction_summary', 'system', 'summary')",
      [conversationId],
    );
    insertMsg(db, conversationId, "assistant", "B".repeat(400)); // after anchor — 100 tokens @ 4char/token

    const est = new ContextEstimator(db);
    const result = est.estimate(conversationId, MAX);

    // 400 chars / 4 = 100 tokens + 400 overhead
    expect(result.usedTokens).toBe(100 + 400);
  });

  it("caps at LIMIT 200: 210 messages after anchor drops 10", () => {
    db.run(
      "INSERT INTO conversation_messages (task_id, conversation_id, type, role, content) VALUES (1, ?, 'compaction_summary', 'system', 'anchor')",
      [conversationId],
    );
    // Insert 210 messages each with 40 chars → 10 tokens each
    for (let i = 0; i < 210; i++) {
      insertMsg(db, conversationId, "assistant", "X".repeat(40));
    }

    const est = new ContextEstimator(db);
    const result = est.estimate(conversationId, MAX);

    // Only 200 messages counted: 200 * 10 = 2000 tokens + 400 overhead = 2400
    expect(result.usedTokens).toBe(2000 + 400);
  });
});

// ─── CE-3: maxTokens cap ─────────────────────────────────────────────────────

describe("ContextEstimator — CE-3: maxTokens cap", () => {
  it("usedTokens never exceeds maxTokens", () => {
    insertExecution(db, conversationId, 200_000); // exceeds MAX
    const est = new ContextEstimator(db);
    const result = est.estimate(conversationId, MAX);
    expect(result.usedTokens).toBeLessThanOrEqual(MAX);
    expect(result.fraction).toBeLessThanOrEqual(1);
  });
});

// ─── CE-4: empty conversation ─────────────────────────────────────────────────

describe("ContextEstimator — CE-4: empty conversation", () => {
  it("returns only the system overhead constant", () => {
    const est = new ContextEstimator(db);
    const result = est.estimate(conversationId, MAX);
    expect(result.usedTokens).toBe(400); // SYSTEM_MESSAGE_OVERHEAD_TOKENS
  });
});
