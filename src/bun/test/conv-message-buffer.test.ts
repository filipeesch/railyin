import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { ConvMessageBuffer } from "../conversation/conv-message-buffer.ts";

let db: Database;
let conversationId: number;
let taskId: number;
let cleanup: () => void;

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

// ─── CMB-1: enqueue does not write to DB ─────────────────────────────────────

describe("ConvMessageBuffer — CMB-1: enqueue is lazy", () => {
  it("enqueue does not INSERT until flush()", () => {
    const buf = new ConvMessageBuffer(db);
    buf.enqueue({ taskId, conversationId, type: "assistant", role: "assistant", content: "hello", notify: false });

    const count = db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) as n FROM conversation_messages WHERE conversation_id = ?",
      )
      .get(conversationId);
    expect(count!.n).toBe(0);
  });
});

// ─── CMB-2: flush inserts all rows in one transaction with real IDs ───────────

describe("ConvMessageBuffer — CMB-2: flush inserts in transaction", () => {
  it("flush() inserts all messages and returns notify=true ones with real IDs", () => {
    const buf = new ConvMessageBuffer(db);
    buf.enqueue({ taskId, conversationId, type: "user", role: "user", content: "question", notify: false });
    buf.enqueue({ taskId, conversationId, type: "assistant", role: "assistant", content: "answer", notify: true });

    const notified = buf.flush();

    // Two rows in DB
    const count = db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) as n FROM conversation_messages WHERE conversation_id = ?",
      )
      .get(conversationId);
    expect(count!.n).toBe(2);

    // Only the notify=true message returned
    expect(notified).toHaveLength(1);
    expect(notified[0].content).toBe("answer");
    expect(typeof notified[0].id).toBe("number");
    expect(notified[0].id).toBeGreaterThan(0);
  });

  it("flush() content and role are preserved round-trip", () => {
    const buf = new ConvMessageBuffer(db);
    buf.enqueue({ taskId, conversationId, type: "tool_call", role: null, content: '{"name":"bash"}', notify: true });

    const notified = buf.flush();
    expect(notified[0].content).toBe('{"name":"bash"}');
    expect(notified[0].role).toBeNull();
  });
});

// ─── CMB-3: empty flush is a no-op ───────────────────────────────────────────

describe("ConvMessageBuffer — CMB-3: empty flush", () => {
  it("flush() on empty buffer returns [] and does not write to DB", () => {
    const buf = new ConvMessageBuffer(db);

    const result = buf.flush();
    expect(result).toEqual([]);

    const count = db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) as n FROM conversation_messages WHERE conversation_id = ?",
      )
      .get(conversationId);
    expect(count!.n).toBe(0);
  });
});
