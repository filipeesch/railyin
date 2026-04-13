import { describe, test, expect, mock, beforeEach } from "bun:test";
import { StreamBatcher } from "./batcher.ts";

// Mock the DB module so tests don't need a real DB
mock.module("../db/stream-events.ts", () => ({
  appendStreamEventBatch: () => {},
}));

describe("StreamBatcher", () => {
  let flushed: ReturnType<typeof StreamBatcher.prototype.flush> extends void ? unknown[][] : never;
  let batcher: StreamBatcher;
  let batches: Array<typeof import("../../shared/rpc-types").StreamEvent[]>;

  beforeEach(() => {
    batches = [];
    batcher = new StreamBatcher(1, 100, (events) => { batches.push([...events]); });
  });

  test("text chunks get the same blockId", () => {
    batcher.push({ type: "text_chunk", content: "hello" });
    batcher.push({ type: "text_chunk", content: " world" });
    batcher.flush();
    expect(batches.length).toBe(1);
    const [a, b] = batches[0];
    expect(a.blockId).toBe(b.blockId);
    expect(a.blockId).toMatch(/^100-t1$/);
  });

  test("reasoning then text → different blockIds", () => {
    batcher.push({ type: "reasoning_chunk", content: "think" });
    batcher.push({ type: "text_chunk", content: "answer" });
    batcher.flush();
    const [r, t] = batches[0];
    expect(r.blockId).toMatch(/^100-r1$/);
    expect(t.blockId).toMatch(/^100-t1$/);
    expect(r.blockId).not.toBe(t.blockId);
  });

  test("interleaved reasoning/text → separate blockId per block", () => {
    batcher.push({ type: "reasoning_chunk", content: "r1" });
    batcher.push({ type: "text_chunk", content: "t1" });
    batcher.push({ type: "reasoning_chunk", content: "r2" });
    batcher.push({ type: "text_chunk", content: "t2" });
    batcher.flush();
    const events = batches[0];
    expect(events[0].blockId).toMatch(/^100-r1$/);
    expect(events[1].blockId).toMatch(/^100-t1$/);
    expect(events[2].blockId).toMatch(/^100-r2$/);
    expect(events[3].blockId).toMatch(/^100-t2$/);
  });

  test("done event triggers immediate flush via stop()", () => {
    batcher.start();
    batcher.push({ type: "text_chunk", content: "hi" });
    batcher.push({ type: "done" });
    // flush should have been called immediately (stop → flush) without waiting 500ms
    expect(batches.length).toBe(1);
    const done = batches[0].find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done!.done).toBe(true);
  });

  test("seq is monotonically increasing", () => {
    batcher.push({ type: "text_chunk", content: "a" });
    batcher.push({ type: "reasoning_chunk", content: "b" });
    batcher.push({ type: "text_chunk", content: "c" });
    batcher.flush();
    const events = batches[0];
    expect(events[0].seq).toBe(0);
    expect(events[1].seq).toBe(1);
    expect(events[2].seq).toBe(2);
  });

  test("tool_call uses explicit blockId and resets text block", () => {
    batcher.push({ type: "text_chunk", content: "preamble" });
    batcher.push({ type: "tool_call", content: "{}", blockId: "call_abc" });
    // tool_call triggers immediate flush — batch 0 has preamble + tool_call
    expect(batches).toHaveLength(1);
    expect(batches[0][0].blockId).toMatch(/^100-t1$/);
    expect(batches[0][1].blockId).toBe("call_abc");
    // Next text_chunk goes into a new buffer
    batcher.push({ type: "text_chunk", content: "summary" });
    batcher.flush();
    expect(batches).toHaveLength(2);
    expect(batches[1][0].blockId).toMatch(/^100-t2$/); // new text block after tool
  });
});
