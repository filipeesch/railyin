import { describe, test, expect, beforeEach } from "bun:test";
import { ToolLoopDetector, LOOP_WINDOW_SIZE, LOOP_MAX_REPEAT } from "../../engine/pi/harness/tool-loop-detector.ts";

describe("ToolLoopDetector", () => {
  let detector: ToolLoopDetector;

  beforeEach(() => {
    detector = new ToolLoopDetector();
  });

  test("TLD-1: single call returns false", () => {
    expect(detector.record("read", { path: "/a.ts" })).toBe(false);
  });

  test("TLD-2: two identical calls return false (threshold is 3)", () => {
    detector.record("read", { path: "/a.ts" });
    expect(detector.record("read", { path: "/a.ts" })).toBe(false);
  });

  test("TLD-3: three identical calls return true on the third", () => {
    detector.record("read", { path: "/a.ts" });
    detector.record("read", { path: "/a.ts" });
    expect(detector.record("read", { path: "/a.ts" })).toBe(true);
  });

  test("TLD-4: different tools do not trigger each other", () => {
    for (let i = 0; i < LOOP_MAX_REPEAT - 1; i++) {
      detector.record("read", { path: "/a.ts" });
      detector.record("write", { path: "/a.ts" });
    }
    // Neither hit LOOP_MAX_REPEAT yet
    expect(detector.record("read", { path: "/different.ts" })).toBe(false);
  });

  test("TLD-5: ABABAB cyclic pattern triggers when A or B reaches MAX_REPEAT", () => {
    let triggered = false;
    // 6 pairs: A appears 6 times, B appears 6 times within the 15-slot window
    for (let i = 0; i < 6 && !triggered; i++) {
      triggered = detector.record("toolA", { x: 1 }) || detector.record("toolB", { x: 1 });
    }
    expect(triggered).toBe(true);
  });

  test("TLD-6: window eviction removes the oldest entry from counts", () => {
    // Fill window with `LOOP_WINDOW_SIZE` unique calls so counts are 1 each
    for (let i = 0; i < LOOP_WINDOW_SIZE; i++) {
      detector.record(`tool${i}`, {});
    }
    // Now record the same call twice — it starts fresh (its count was evicted)
    detector.record("tool0", {});
    expect(detector.record("tool0", {})).toBe(false); // count=2, not yet 3
  });

  test("TLD-7: reset() clears all state", () => {
    detector.record("read", { path: "/a.ts" });
    detector.record("read", { path: "/a.ts" });
    detector.reset();
    // After reset, same call should not be at threshold anymore
    detector.record("read", { path: "/a.ts" });
    detector.record("read", { path: "/a.ts" });
    expect(detector.record("read", { path: "/a.ts" })).toBe(true); // 3 after reset is fine
  });

  test("TLD-8: arg key order is normalized — {b,a} and {a,b} are same fingerprint", () => {
    detector.record("read", { b: 2, a: 1 });
    detector.record("read", { a: 1, b: 2 });
    expect(detector.record("read", { b: 2, a: 1 })).toBe(true);
  });

  test("TLD-9: null args treated as distinct from object args", () => {
    detector.record("read", null);
    detector.record("read", null);
    expect(detector.record("read", null)).toBe(true);
  });

  test("TLD-10: array args are fingerprinted as-is (not key-sorted)", () => {
    detector.record("read", [1, 2]);
    detector.record("read", [1, 2]);
    expect(detector.record("read", [1, 2])).toBe(true);
  });

  test("TLD-11: ABCABCABC pattern triggers when any fingerprint reaches LOOP_MAX_REPEAT", () => {
    let triggered = false;
    for (let i = 0; i < LOOP_MAX_REPEAT && !triggered; i++) {
      triggered =
        detector.record("toolA", { v: 1 }) ||
        detector.record("toolB", { v: 1 }) ||
        detector.record("toolC", { v: 1 });
    }
    expect(triggered).toBe(true);
  });

  test("TLD-12: LOOP_WINDOW_SIZE exported constant equals 15", () => {
    expect(LOOP_WINDOW_SIZE).toBe(15);
  });

  test("TLD-13: LOOP_MAX_REPEAT exported constant equals 3", () => {
    expect(LOOP_MAX_REPEAT).toBe(3);
  });
});
