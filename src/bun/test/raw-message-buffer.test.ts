import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Db } from "../db/db.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { createRawMessageBuffer } from "../engine/stream/raw-message-buffer.ts";
import type { RawModelMessage } from "../engine/types.ts";
import { createMockWait } from "./support/mock-wait.ts";

let db: Db;
let taskId: number;
let executionId: number;
let cleanup: () => void;

function makeRawMsg(tag: string): RawModelMessage {
  return {
    engine: "claude",
    sessionId: undefined,
    direction: "inbound",
    eventType: "token",
    eventSubtype: undefined,
    payload: { text: tag },
  };
}

async function insertExecution(db: Db, tid: number): Promise<number> {
  const row = await db.get<{ id: number }>(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES ($1, 1, 'plan', 'plan', 'human-turn', 'running', 1) RETURNING id",
    [tid],
  );
  return row!.id;
}

async function countRaw(db: Db, eid: number): Promise<number> {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) as n FROM model_raw_messages WHERE execution_id = $1",
    [eid],
  );
  return row!.n;
}

beforeEach(async () => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = await initDb();
  const seed = await seedProjectAndTask(db, "/test");
  taskId = seed.taskId;
  executionId = await insertExecution(db, taskId);
});

afterEach(() => {
  cleanup();
});

describe("RawMessageBuffer — count-based loop wakeup at maxBatch:50", () => {
  it("49 enqueues do not flush", async () => {
    const buf = createRawMessageBuffer(db);
    for (let i = 0; i < 49; i++) {
      buf.enqueue({ taskId, conversationId: 1, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    expect(await countRaw(db, executionId)).toBe(0);
  });

  it("50th enqueue does NOT flush synchronously (no event loop block)", async () => {
    // enqueue() must never flush synchronously to avoid blocking WS broadcasts.
    const buf = createRawMessageBuffer(db);
    for (let i = 0; i < 50; i++) {
      buf.enqueue({ taskId, conversationId: 1, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    // Immediately after enqueue — still zero because flush is async
    expect(await countRaw(db, executionId)).toBe(0);
  });

  it("50th enqueue wakes the loop to flush soon", async () => {
    const { waitFn } = createMockWait();
    const buf = createRawMessageBuffer(db, { waitFn });
    buf.start();
    for (let i = 0; i < 50; i++) {
      buf.enqueue({ taskId, conversationId: 1, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    // The loop is woken via _tick() — wait for macrotask to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(await countRaw(db, executionId)).toBe(50);
    buf.stop();
  });
});

describe("RawMessageBuffer — manual flush", () => {
  it("flush() persists all pending rows and returns them", async () => {
    const buf = createRawMessageBuffer(db);
    buf.enqueue({ taskId, conversationId: 1, executionId, seq: 0, raw: makeRawMsg("alpha") });
    buf.enqueue({ taskId, conversationId: 1, executionId, seq: 1, raw: makeRawMsg("beta") });

    const items = buf.flush();
    expect(items).toHaveLength(2);
    // flush() writes fire-and-forget via await db.begin() — wait for the macrotask
    await new Promise((r) => setTimeout(r, 10));
    expect(await countRaw(db, executionId)).toBe(2);
  });

  it("flush() on empty returns [] without writing", async () => {
    const buf = createRawMessageBuffer(db);
    const result = buf.flush();
    expect(result).toEqual([]);
    expect(await countRaw(db, executionId)).toBe(0);
  });
});

describe("RawMessageBuffer — data integrity", () => {
  it("fields preserved after round-trip", async () => {
    const buf = createRawMessageBuffer(db);
    buf.enqueue({ taskId, conversationId: 1, executionId, seq: 7, raw: makeRawMsg("payload-check") });
    buf.flush();
    // flush() writes fire-and-forget via await db.begin() — wait for the macrotask
    await new Promise((r) => setTimeout(r, 10));

    const row = (await db.get<{ event_type: string; stream_seq: number; payload_json: string }>(
      "SELECT event_type, stream_seq, payload_json FROM model_raw_messages WHERE execution_id = $1 LIMIT 1",
      [executionId],
    ))!;

    expect(row.event_type).toBe("token");
    expect(row.stream_seq).toBe(7);
    expect(JSON.parse(row.payload_json)).toEqual({ text: "payload-check" });
  });
});
