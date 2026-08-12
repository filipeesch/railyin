/**
 * Tests for the Logger interface, noopLogger, and realLogger exports in logger.ts.
 *
 * Unit tests verify the interface contracts without a DB.
 * Integration tests call initDb() so realLogger can write to the logs table.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { noopLogger, realLogger } from "../logger.ts";
import { makeSpyLogger } from "./support/logger-test-utils.ts";

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

// ─── realLogger (console output) ──────────────────────────────────────────────

describe("realLogger (console output)", () => {
  let logged: unknown[] = [];
  let warned: unknown[] = [];
  let errored: unknown[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  beforeEach(() => {
    logged = [];
    warned = [];
    errored = [];
    console.log = (m: unknown) => { logged.push(m); };
    console.warn = (m: unknown) => { warned.push(m); };
    console.error = (m: unknown) => { errored.push(m); };
  });

  afterEach(() => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  });

  it("writes a structured JSON line to console", () => {
    realLogger.log("info", "test-entry");
    expect(logged).toHaveLength(1);
    const entry = JSON.parse(String(logged[0]));
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("test-entry");
  });

  it("includes taskId and executionId when provided", () => {
    realLogger.log("debug", "with-ids", { taskId: 7, executionId: 42 });
    const entry = JSON.parse(String(logged[0]));
    expect(entry.taskId).toBe(7);
    expect(entry.executionId).toBe(42);
  });

  it("does not throw with undefined opts", () => {
    expect(() => realLogger.log("warn", "no-opts")).not.toThrow();
  });

  it("routes warn and error levels to console.warn/error", () => {
    realLogger.log("warn", "careful");
    realLogger.log("error", "boom");
    expect(warned).toHaveLength(1);
    expect(errored).toHaveLength(1);
    expect(JSON.parse(String(warned[0])).message).toBe("careful");
    expect(JSON.parse(String(errored[0])).message).toBe("boom");
  });
});
