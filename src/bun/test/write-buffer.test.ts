import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { WriteBuffer } from "../pipeline/write-buffer.ts";
import { createMockWait } from "./support/mock-wait.ts";

// ─── WB-1: count-triggered loop wakeup ────────────────────────────────────────

describe("WriteBuffer — WB-1: wakeup loop on maxBatch (no sync flush)", () => {
  it("does NOT flush synchronously when pending items reach maxBatch", () => {
    // enqueue() must never call flushFn synchronously — doing so would block the
    // event loop in the caller's context and delay WS broadcasts (streaming bursts).
    const flushed: number[][] = [];
    const buf = new WriteBuffer<number>({
      maxBatch: 3,
      flushFn: (items) => flushed.push([...items]),
    });

    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3); // reaches maxBatch — must NOT flush synchronously
    expect(flushed).toHaveLength(0); // still zero — flush is deferred
  });

  it("wakes the loop to flush soon when maxBatch is reached", async () => {
    const flushed: number[][] = [];
    const { waitFn, tick } = createMockWait();
    const buf = new WriteBuffer<number>({
      maxBatch: 3,
      flushFn: (items) => flushed.push([...items]),
      waitFn,
    });

    buf.start();
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3); // wakes the loop via _tick()

    // Loop resumes + setImmediate + flush — need to let all macrotasks drain
    await new Promise((r) => setTimeout(r, 10));

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual([1, 2, 3]);

    buf.stop();
  });
});

// ─── WB-2: interval flush via tick ────────────────────────────────────────────

describe("WriteBuffer — WB-2: tick-based interval flush", () => {
  it("flushes pending items when tick() is called", async () => {
    const flushed: string[][] = [];
    const { waitFn, tick } = createMockWait();
    const buf = new WriteBuffer<string>({
      maxBatch: 100,
      flushFn: (items) => flushed.push([...items]),
      waitFn,
    });

    buf.start();
    buf.enqueue("a");
    buf.enqueue("b");

    expect(flushed).toHaveLength(0);

    tick();
    // Give the loop microtask a chance to resume
    await new Promise((r) => setTimeout(r, 0));

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual(["a", "b"]);

    buf.stop();
  });

  it("tick() on empty buffer is a no-op (does not call flushFn)", async () => {
    const flushCalls: number[] = [];
    const { waitFn, tick } = createMockWait();
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: (items) => flushCalls.push(items.length),
      waitFn,
    });

    buf.start();

    tick(); // no pending items
    await new Promise((r) => setTimeout(r, 0));

    expect(flushCalls).toHaveLength(0);

    buf.stop();
  });
});

// ─── WB-3: manual flush ───────────────────────────────────────────────────────

describe("WriteBuffer — WB-3: manual flush", () => {
  it("flush() returns items and clears pending", () => {
    const flushed: number[][] = [];
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: (items) => flushed.push([...items]),
    });

    buf.enqueue(10);
    buf.enqueue(20);

    const returned = buf.flush();
    expect(returned).toEqual([10, 20]);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual([10, 20]);
  });

  it("flush() on empty buffer returns [] and does not call flushFn", () => {
    const flushCalls: number[] = [];
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: (items) => flushCalls.push(items.length),
    });

    const result = buf.flush();
    expect(result).toEqual([]);
    expect(flushCalls).toHaveLength(0);
  });
});

// ─── WB-4: stop flushes remaining items ───────────────────────────────────────

describe("WriteBuffer — WB-4: stop flushes remaining items", () => {
  it("stop() flushes pending items and halts the loop", async () => {
    const flushed: string[][] = [];
    const { waitFn, tick: _tick } = createMockWait();
    const buf = new WriteBuffer<string>({
      maxBatch: 100,
      flushFn: (items) => flushed.push([...items]),
      waitFn,
    });

    buf.start();
    buf.enqueue("x");
    buf.enqueue("y");

    buf.stop();
    await new Promise((r) => setTimeout(r, 0));

    expect(flushed.flat()).toContain("x");
    expect(flushed.flat()).toContain("y");
  });
});
