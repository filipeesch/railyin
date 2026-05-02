/**
 * Tests for the Logger interface, noopLogger, and realLogger exports in logger.ts.
 *
 * Unit tests verify the interface contracts without a DB.
 * Integration tests call initDb() so realLogger can write to the logs table.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { noopLogger, realLogger } from "../logger.ts";
import { makeSpyLogger } from "./support/logger-test-utils.ts";
import { initDb } from "./helpers.ts";

// ─── noopLogger ───────────────────────────────────────────────────────────────

describe("noopLogger", () => {
  it("does not throw for any log level", () => {
    expect(() => noopLogger.log("debug", "msg")).not.toThrow();
    expect(() => noopLogger.log("info", "msg")).not.toThrow();
    expect(() => noopLogger.log("warn", "msg")).not.toThrow();
    expect(() => noopLogger.log("error", "msg")).not.toThrow();
  });

  it("accepts opts without throwing", () => {
    expect(() => noopLogger.log("info", "msg", { taskId: 1, executionId: 2, data: { x: 1 } })).not.toThrow();
  });
});

// ─── makeSpyLogger ────────────────────────────────────────────────────────────

describe("makeSpyLogger", () => {
  it("captures level and message", () => {
    const spy = makeSpyLogger();
    spy.log("warn", "something bad");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].level).toBe("warn");
    expect(spy.calls[0].message).toBe("something bad");
  });

  it("captures opts", () => {
    const spy = makeSpyLogger();
    spy.log("debug", "detail", { taskId: 99 });
    expect(spy.calls[0].opts?.taskId).toBe(99);
  });

  it("accumulates multiple calls", () => {
    const spy = makeSpyLogger();
    spy.log("debug", "first");
    spy.log("info", "second");
    spy.log("warn", "third");
    expect(spy.calls).toHaveLength(3);
  });

  it("reset() clears all captured calls", () => {
    const spy = makeSpyLogger();
    spy.log("info", "before reset");
    spy.reset();
    expect(spy.calls).toHaveLength(0);
  });

  it("fresh instance starts with empty calls", () => {
    const spy = makeSpyLogger();
    expect(spy.calls).toHaveLength(0);
  });
});

// ─── realLogger integration ───────────────────────────────────────────────────

describe("realLogger (integration)", () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb();
  });

  it("writes a log row to the logs table", () => {
    realLogger.log("info", "test-entry");
    const row = db
      .query<{ level: string; message: string }, []>("SELECT level, message FROM logs WHERE message = 'test-entry' LIMIT 1")
      .get();
    expect(row).not.toBeNull();
    expect(row?.level).toBe("info");
    expect(row?.message).toBe("test-entry");
  });

  it("stores taskId and executionId when provided", () => {
    realLogger.log("debug", "with-ids", { taskId: 7, executionId: 42 });
    const row = db
      .query<{ task_id: number | null; execution_id: number | null }, []>(
        "SELECT task_id, execution_id FROM logs WHERE message = 'with-ids' LIMIT 1",
      )
      .get();
    expect(row?.task_id).toBe(7);
    expect(row?.execution_id).toBe(42);
  });

  it("does not throw with undefined opts", () => {
    expect(() => realLogger.log("warn", "no-opts")).not.toThrow();
  });
});
