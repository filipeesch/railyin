import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { createRawMessageBuffer } from "../engine/stream/raw-message-buffer.ts";
import type { RawMessageDebugLogWriter } from "../conversation/raw-message-debug-log.ts";
import type { RawMessageItem } from "../engine/stream/raw-message-buffer.ts";
import type { RawModelMessage } from "../engine/types.ts";
import { createMockWait } from "./support/mock-wait.ts";

let db: Database;
let taskId: number;
let executionId: number;
let cleanup: () => void;
let writer: FakeRawMessageDebugLogWriter;

/** Captures appended items in-memory instead of writing real files — keeps this test
 *  suite focused on `WriteBuffer`'s batching/timing behavior, not file I/O. */
class FakeRawMessageDebugLogWriter implements RawMessageDebugLogWriter {
  readonly appended: RawMessageItem[] = [];
  async append(items: RawMessageItem[]): Promise<void> {
    this.appended.push(...items);
  }
}

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

function insertExecution(db: Database, tid: number): number {
  db.run(
    "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, 1, 'plan', 'plan', 'human-turn', 'running', 1)",
    [tid],
  );
  return (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
}

function countRaw(eid: number): number {
  return writer.appended.filter((item) => item.executionId === eid).length;
}

beforeEach(() => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test");
  taskId = seed.taskId;
  executionId = insertExecution(db, taskId);
  writer = new FakeRawMessageDebugLogWriter();
});

afterEach(() => {
  cleanup();
});

describe("RawMessageBuffer — count-based loop wakeup at maxBatch:50", () => {
  it("49 enqueues do not flush", () => {
    const buf = createRawMessageBuffer(writer);
    for (let i = 0; i < 49; i++) {
      buf.enqueue({ taskId, conversationId: 1, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    expect(countRaw(executionId)).toBe(0);
  });

  it("50th enqueue does NOT flush synchronously (no event loop block)", () => {
    // enqueue() must never flush synchronously to avoid blocking WS broadcasts.
    const buf = createRawMessageBuffer(writer);
    for (let i = 0; i < 50; i++) {
      buf.enqueue({ taskId, conversationId: 1, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    // Immediately after enqueue — still zero because flush is async
    expect(countRaw(executionId)).toBe(0);
  });

  it("50th enqueue wakes the loop to flush soon", async () => {
    const { waitFn } = createMockWait();
    const buf = createRawMessageBuffer(writer, { waitFn });
    buf.start();
    for (let i = 0; i < 50; i++) {
      buf.enqueue({ taskId, conversationId: 1, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    // The loop is woken via _tick() — wait for macrotask to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(countRaw(executionId)).toBe(50);
    buf.stop();
  });
});

describe("RawMessageBuffer — manual flush", () => {
  it("flush() enqueues all pending rows for the writer and returns them", async () => {
    const buf = createRawMessageBuffer(writer);
    buf.enqueue({ taskId, conversationId: 1, executionId, seq: 0, raw: makeRawMsg("alpha") });
    buf.enqueue({ taskId, conversationId: 1, executionId, seq: 1, raw: makeRawMsg("beta") });

    const items = buf.flush();
    expect(items).toHaveLength(2);
    // flushFn is fire-and-forget (async writer) — wait a macrotask for it to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(countRaw(executionId)).toBe(2);
  });

  it("flush() on empty returns [] without writing", async () => {
    const buf = createRawMessageBuffer(writer);
    const result = buf.flush();
    expect(result).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(countRaw(executionId)).toBe(0);
  });
});

describe("RawMessageBuffer — data integrity", () => {
  it("fields preserved after round-trip", async () => {
    const buf = createRawMessageBuffer(writer);
    buf.enqueue({ taskId, conversationId: 1, executionId, seq: 7, raw: makeRawMsg("payload-check") });
    buf.flush();
    await new Promise((r) => setTimeout(r, 0));

    const item = writer.appended.find((i) => i.executionId === executionId);
    expect(item).toBeDefined();
    expect(item!.raw.eventType).toBe("token");
    expect(item!.seq).toBe(7);
    expect(item!.raw.payload).toEqual({ text: "payload-check" });
  });
});
