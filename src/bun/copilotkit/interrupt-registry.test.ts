/**
 * interrupt-registry.test.ts — module-level per-thread pending-interrupt
 * registry lifecycle (Phase 3, D-04/D-05, A3 id scheme). Pure in-memory state
 * — no DB seeding. reset() in beforeEach (Pattern 6) prevents cross-test
 * leakage across the module singleton.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import * as interruptRegistry from "./interrupt-registry.ts";

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
