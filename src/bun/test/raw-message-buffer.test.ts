import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { createRawMessageBuffer } from "../engine/stream/raw-message-buffer.ts";
import type { RawModelMessage } from "../types.ts";

let db: Database;
let taskId: number;
let executionId: number;
let cleanup: () => void;

function makeRawMsg(tag: string): RawModelMessage {
  return {
    engine: "test-engine",
    sessionId: null,
    direction: "in" as const,
    eventType: "token",
    eventSubtype: null,
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

function countRaw(db: Database, eid: number): number {
  return db
    .query<{ n: number }, [number]>("SELECT COUNT(*) as n FROM model_raw_messages WHERE execution_id = ?")
    .get(eid)!.n;
}

beforeEach(() => {
  const cfg = setupTestConfig();
  cleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test");
  taskId = seed.taskId;
  executionId = insertExecution(db, taskId);
});

afterEach(() => {
  cleanup();
});

describe("RawMessageBuffer — count-based auto-flush at maxBatch:50", () => {
  it("49 enqueues do not flush", () => {
    const buf = createRawMessageBuffer(db);
    for (let i = 0; i < 49; i++) {
      buf.enqueue({ taskId, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    expect(countRaw(db, executionId)).toBe(0);
  });

  it("50th enqueue triggers auto-flush", () => {
    const buf = createRawMessageBuffer(db);
    for (let i = 0; i < 50; i++) {
      buf.enqueue({ taskId, executionId, seq: i, raw: makeRawMsg(`item-${i}`) });
    }
    expect(countRaw(db, executionId)).toBe(50);
  });
});

describe("RawMessageBuffer — manual flush", () => {
  it("flush() persists all pending rows and returns them", () => {
    const buf = createRawMessageBuffer(db);
    buf.enqueue({ taskId, executionId, seq: 0, raw: makeRawMsg("alpha") });
    buf.enqueue({ taskId, executionId, seq: 1, raw: makeRawMsg("beta") });

    const items = buf.flush();
    expect(items).toHaveLength(2);
    expect(countRaw(db, executionId)).toBe(2);
  });

  it("flush() on empty returns [] without writing", () => {
    const buf = createRawMessageBuffer(db);
    const result = buf.flush();
    expect(result).toEqual([]);
    expect(countRaw(db, executionId)).toBe(0);
  });
});

describe("RawMessageBuffer — data integrity", () => {
  it("fields preserved after round-trip", () => {
    const buf = createRawMessageBuffer(db);
    buf.enqueue({ taskId, executionId, seq: 7, raw: makeRawMsg("payload-check") });
    buf.flush();

    const row = db
      .query<{ event_type: string; stream_seq: number; payload_json: string }, [number]>(
        "SELECT event_type, stream_seq, payload_json FROM model_raw_messages WHERE execution_id = ? LIMIT 1",
      )
      .get(executionId)!;

    expect(row.event_type).toBe("token");
    expect(row.stream_seq).toBe(7);
    expect(JSON.parse(row.payload_json)).toEqual({ text: "payload-check" });
  });
});
