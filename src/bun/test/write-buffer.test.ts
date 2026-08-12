import { describe, it, expect } from "vitest";
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
    const { waitFn, tick: _tick } = createMockWait();
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

// ─── WB-5: error handling — SQLITE_BUSY requeue, bounded retry, never-die ─────

describe("WriteBuffer — WB-5: error handling", () => {
  function busyError(): Error & { code: string } {
    const err = new Error("database is locked") as Error & { code: string };
    err.code = "SQLITE_BUSY";
    return err;
  }

  it("requeues a SQLITE_BUSY batch and retries it on the next flush", () => {
    const flushed: number[][] = [];
    const errors: unknown[] = [];
    let attempts = 0;
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: (items) => {
        attempts++;
        if (attempts === 1) throw busyError();
        flushed.push([...items]);
      },
      onError: (err, items) => errors.push({ err, items }),
    });

    buf.enqueue(1);
    buf.enqueue(2);

    const first = buf.flush(); // busy → requeued, nothing flushed
    expect(first).toEqual([]);
    expect(flushed).toHaveLength(0);
    expect(errors).toHaveLength(0);

    const second = buf.flush(); // retry succeeds
    expect(second).toEqual([1, 2]);
    expect(flushed).toEqual([[1, 2]]);
    expect(errors).toHaveLength(0);
  });

  it("drops the batch after maxBusyRetries consecutive failures", () => {
    const errors: unknown[] = [];
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: () => { throw busyError(); },
      maxBusyRetries: 1, // allow 1 requeue; drop on the 2nd consecutive failure
      onError: (err, items) => errors.push({ err, items }),
    });

    buf.enqueue(1);
    buf.flush(); // attempt 1 — requeued
    expect(errors).toHaveLength(0);
    buf.flush(); // attempt 2 — dropped
    expect(errors).toHaveLength(1);

    // Buffer continues to accept new items; the failure counter resets
    buf.enqueue(2);
    buf.flush(); // attempt 1 for the new batch — requeued
    buf.flush(); // attempt 2 — dropped again
    expect(errors).toHaveLength(2);
  });

  it("non-busy errors drop the batch immediately (never requeued)", () => {
    const errors: unknown[] = [];
    let failNext = true;
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: () => {
        if (failNext) {
          failNext = false;
          throw new Error("constraint violation");
        }
      },
      onError: (err, items) => errors.push({ err, items }),
    });

    buf.enqueue(7);
    const result = buf.flush();
    expect(result).toEqual([]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as { items: number[] }).items).toEqual([7]);

    // Fresh batch flushes normally
    buf.enqueue(8);
    expect(buf.flush()).toEqual([8]);
    expect(errors).toHaveLength(1);
  });

  it("background loop keeps running after a busy flush failure", async () => {
    const flushed: number[][] = [];
    const { waitFn, tick } = createMockWait();
    let failNext = true;
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: (items) => {
        if (failNext) {
          failNext = false;
          throw busyError();
        }
        flushed.push([...items]);
      },
      waitFn,
    });

    buf.start();
    buf.enqueue(1);

    tick(); // first flush fails with busy → batch requeued
    await new Promise((r) => setTimeout(r, 0));
    expect(flushed).toHaveLength(0);

    tick(); // retry succeeds
    await new Promise((r) => setTimeout(r, 0));
    expect(flushed).toEqual([[1]]);

    buf.stop();
  });

  it("stop() never throws when flushFn fails", () => {
    const buf = new WriteBuffer<number>({
      maxBatch: 100,
      flushFn: () => { throw busyError(); },
      maxBusyRetries: 0,
    });

    buf.enqueue(1);
    expect(() => buf.stop()).not.toThrow();
  });
});
