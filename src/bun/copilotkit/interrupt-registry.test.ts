/**
 * interrupt-registry.test.ts — module-level per-thread pending-interrupt
 * registry lifecycle (Phase 3, D-04/D-05, A3 id scheme). Pure in-memory state
 * — no DB seeding. reset() in beforeEach (Pattern 6) prevents cross-test
 * leakage across the module singleton.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BaseEvent } from "@ag-ui/client";
import type { Database } from "bun:sqlite";
import * as interruptRegistry from "./interrupt-registry.ts";
import { JsonlStore } from "./jsonl-store.ts";
import { initDb } from "../test/helpers.ts";

beforeEach(() => {
  interruptRegistry.reset();
});

describe("interrupt-registry", () => {
  test("register mints decision-<conv>-<seq> incrementing per thread (A3)", () => {
    expect(interruptRegistry.register(7, "{}")).toBe("decision-7-1");
    expect(interruptRegistry.register(7, "{}")).toBe("decision-7-2");
  });

  test("independent threads keep independent seqs", () => {
    expect(interruptRegistry.register(7, "{}")).toBe("decision-7-1");
    expect(interruptRegistry.register(9, "{}")).toBe("decision-9-1");
    expect(interruptRegistry.register(7, "{}")).toBe("decision-7-2");
    expect(interruptRegistry.register(9, "{}")).toBe("decision-9-2");
  });

  test("get returns the entry with executionId null; payload stored raw (parsing stays in the bridge)", () => {
    const payload = JSON.stringify({ context: "ctx", questions: [] });
    const id = interruptRegistry.register(7, payload);
    const entry = interruptRegistry.get("7");
    expect(entry?.interruptId).toBe(id);
    expect(entry?.conversationId).toBe(7);
    expect(entry?.executionId).toBeNull();
    expect(entry?.payload).toBe(payload);
    expect(typeof entry?.createdAt).toBe("number");
    expect(interruptRegistry.get("nope")).toBeUndefined();
  });

  test("clear removes the entry (hasOpen false) but keeps the per-thread seq", () => {
    interruptRegistry.register(7, "{}");
    expect(interruptRegistry.hasOpen("7")).toBe(true);
    interruptRegistry.clear("7");
    expect(interruptRegistry.hasOpen("7")).toBe(false);
    expect(interruptRegistry.get("7")).toBeUndefined();
    // Next batch on the same thread continues the counter (-2, not -1).
    expect(interruptRegistry.register(7, "{}")).toBe("decision-7-2");
  });

  test("updateExecutionId sets only an existing entry's executionId; no-op when none (Pitfall 3)", () => {
    interruptRegistry.register(7, "{}");
    interruptRegistry.updateExecutionId("7", 42);
    expect(interruptRegistry.get("7")?.executionId).toBe(42);
    // No entry → no throw, nothing stored.
    interruptRegistry.updateExecutionId("99", 1);
    expect(interruptRegistry.get("99")).toBeUndefined();
  });

  test("reset empties all threads including seq counters (Pattern 6)", () => {
    interruptRegistry.register(7, "{}");
    interruptRegistry.register(9, "{}");
    interruptRegistry.reset();
    expect(interruptRegistry.hasOpen("7")).toBe(false);
    expect(interruptRegistry.hasOpen("9")).toBe(false);
    // Seq counter reset too — the first id after reset is -1 again.
    expect(interruptRegistry.register(7, "{}")).toBe("decision-7-1");
  });
});

describe("interrupt-registry lazy rebuild (03-03 Task 2, A2/Open Question 1)", () => {
  function makeStore(): { dir: string; store: JsonlStore; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), "railyn-rebuild-"));
    return { dir, store: new JsonlStore(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  /** A complete interrupt-terminal run (RUN_STARTED … RUN_FINISHED outcome.interrupt). */
  function appendInterruptRun(store: JsonlStore, threadId: string, runId: string, interruptId: string): void {
    store.append(threadId, { type: "RUN_STARTED", threadId, runId } as unknown as BaseEvent);
    store.append(threadId, { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" } as unknown as BaseEvent);
    store.append(threadId, { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "I need your decision." } as unknown as BaseEvent);
    store.append(threadId, { type: "TEXT_MESSAGE_END", messageId: "m1" } as unknown as BaseEvent);
    store.append(threadId, {
      type: "RUN_FINISHED",
      threadId,
      runId,
      outcome: {
        type: "interrupt",
        interrupts: [{
          id: interruptId,
          reason: "decision_request",
          message: "mock context",
          metadata: { context: "mock context", questions: [{ question: "Q1" }] },
        }],
      },
    } as unknown as BaseEvent);
  }

  test("C: ensureOpen rebuilds the pending interrupt from the JSONL tail + waiting_user row — SAME id, correlated executionId, seq continuity (A2)", () => {
    const { dir, store, cleanup } = makeStore();
    const db = initDb();
    try {
      appendInterruptRun(store, "7", "int-1", "decision-7-3");
      db.run("INSERT INTO conversations (id, task_id) VALUES (7, NULL)");
      db.run(
        "INSERT INTO executions (conversation_id, from_state, to_state, status) VALUES (7, 'backlog', 'plan', 'waiting_user')",
      );
      const row = db.query<{ id: number }, []>("SELECT id FROM executions WHERE conversation_id = 7").get()!;
      interruptRegistry.configure({ store });

      // Registry empty at boot — the rebuild restores the persisted entry.
      expect(interruptRegistry.get("7")).toBeUndefined();
      const entry = interruptRegistry.ensureOpen("7", db);
      expect(entry).not.toBeNull();
      expect(entry!.interruptId).toBe("decision-7-3"); // SAME persisted id — never minted (T-03-15)
      expect(entry!.conversationId).toBe(7);
      expect(entry!.executionId).toBe(row.id); // correlated from the durable row
      expect(entry!.payload).toContain("mock context"); // metadata round-tripped
      expect(interruptRegistry.get("7")).toBe(entry!);

      // ensureOpen is idempotent — returns the existing entry without re-reading.
      expect(interruptRegistry.ensureOpen("7", db)).toBe(entry);

      // Counter continuity: the next register on the thread mints seq+1
      // (register() replaces the pending entry with the fresh batch's).
      expect(interruptRegistry.register(7, "{}")).toBe("decision-7-4");
      expect(interruptRegistry.get("7")?.interruptId).toBe("decision-7-4");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("C2: the rebuild scans BACKWARDS — a later resume run does not shadow the interrupt terminal", () => {
    const { dir, store, cleanup } = makeStore();
    const db = initDb();
    try {
      appendInterruptRun(store, "8", "int-1", "decision-8-1");
      // A later resume run on the same thread — its RUN_FINISHED is NOT an
      // interrupt terminal, so the scan must still find the FIRST run's.
      store.append("8", { type: "RUN_STARTED", threadId: "8", runId: "res-1" } as unknown as BaseEvent);
      store.append("8", { type: "TEXT_MESSAGE_CONTENT", messageId: "m2", delta: "continuing" } as unknown as BaseEvent);
      store.append("8", { type: "RUN_FINISHED", threadId: "8", runId: "res-1", result: null } as unknown as BaseEvent);
      db.run("INSERT INTO conversations (id, task_id) VALUES (8, NULL)");
      db.run(
        "INSERT INTO executions (conversation_id, from_state, to_state, status) VALUES (8, 'backlog', 'plan', 'waiting_user')",
      );
      interruptRegistry.configure({ store });

      const entry = interruptRegistry.ensureOpen("8", db);
      expect(entry?.interruptId).toBe("decision-8-1");
    } finally {
      db.close();
      cleanup();
    }
  });

  test("D: ensureOpen returns null when nothing is rebuildable — no log, or a log without an interrupt terminal", () => {
    const { dir, store, cleanup } = makeStore();
    const db = initDb();
    try {
      interruptRegistry.configure({ store });

      // No log at all → null (nothing to rebuild, resume rejects cleanly).
      expect(interruptRegistry.ensureOpen("99", db)).toBeNull();

      // A completed plain run — no interrupt terminal → null.
      store.append("6", { type: "RUN_STARTED", threadId: "6", runId: "plain-1" } as unknown as BaseEvent);
      store.append("6", { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hi" } as unknown as BaseEvent);
      store.append("6", { type: "RUN_FINISHED", threadId: "6", runId: "plain-1", result: null } as unknown as BaseEvent);
      expect(interruptRegistry.ensureOpen("6", db)).toBeNull();

      // Nothing registered as a side effect of the null results.
      expect(interruptRegistry.get("99")).toBeUndefined();
      expect(interruptRegistry.get("6")).toBeUndefined();
    } finally {
      db.close();
      cleanup();
    }
  });
});
