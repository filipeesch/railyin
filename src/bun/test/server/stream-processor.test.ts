import { describe, test, expect, beforeEach } from "bun:test";
import { StreamEventProcessor } from "../../server/stream-processor.ts";
import type { IBroadcastChannel } from "../../server/broadcast-channel.ts";
import type { StreamEvent, StreamEventType } from "../../../shared/rpc-types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeChannel(): { channel: IBroadcastChannel; calls: object[] } {
  const calls: object[] = [];
  return { channel: { broadcast: (msg: object) => calls.push(msg) }, calls };
}

function makeStreamEvent(overrides: Partial<{
  executionId: number;
  conversationId: number;
  taskId: number;
  type: StreamEventType;
  content: string;
  done: boolean;
}> = {}): StreamEvent {
  return {
    taskId: 1,
    conversationId: 1,
    executionId: 1,
    seq: 0,
    blockId: "",
    type: "assistant" as StreamEventType,
    content: "hello",
    metadata: null,
    parentBlockId: null,
    subagentId: null,
    done: false,
    ...overrides,
  } as StreamEvent;
}

function makeClaudeDelta(text: string, executionId = 1) {
  return {
    executionId,
    taskId: 1,
    conversationId: 1,
    seq: 0,
    raw: {
      engine: "claude" as const,
      eventType: "content_block_delta",
      direction: "in" as const,
      payload: {
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
      },
    },
  };
}

function makeClaudeThinkingDelta(thinking: string, executionId = 1) {
  return {
    executionId,
    taskId: 1,
    conversationId: 1,
    seq: 0,
    raw: {
      engine: "claude" as const,
      eventType: "content_block_delta",
      direction: "in" as const,
      payload: {
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking },
        },
      },
    },
  };
}

function makeCopilotMessageDelta(deltaContent: string, executionId = 1) {
  return {
    executionId,
    taskId: 1,
    conversationId: 1,
    seq: 0,
    raw: {
      engine: "copilot" as const,
      eventType: "assistant.message_delta",
      direction: "in" as const,
      payload: {
        data: { deltaContent },
      },
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("StreamEventProcessor", () => {
  let channel: IBroadcastChannel;
  let calls: object[];
  let proc: StreamEventProcessor;

  beforeEach(() => {
    const ch = makeChannel();
    channel = ch.channel;
    calls = ch.calls;
    proc = new StreamEventProcessor(channel);
  });

  // SP-1 — Every event is broadcast (persistence is out of scope; that's the durable
  // conversation message store's job, not StreamEventProcessor's).
  test("SP-1: text_chunk broadcasts", () => {
    proc.onStreamEvent(makeStreamEvent({ type: "text_chunk" as any, done: false }));
    expect(calls).toHaveLength(1);
  });

  // SP-2 — done=true still broadcasts (flush semantics moved to the message store; the
  // processor's only remaining responsibility is enrichment + broadcast).
  test("SP-2: assistant event broadcasts on done=true", () => {
    proc.onStreamEvent(makeStreamEvent({ type: "assistant", content: "world", done: true }));
    expect(calls).toHaveLength(1);
    const msg = calls[0] as { type: string; payload: { type: string; content: string } };
    expect(msg.payload.type).toBe("assistant");
    expect(msg.payload.content).toBe("world");
  });

  // SP-3 — Seq numbers are monotonically increasing per execution
  test("SP-3: seq numbers are 0, 1, 2 for three events on the same execution", () => {
    proc.onStreamEvent(makeStreamEvent({ type: "assistant", content: "a", done: false }));
    proc.onStreamEvent(makeStreamEvent({ type: "assistant", content: "b", done: false }));
    proc.onStreamEvent(makeStreamEvent({ type: "assistant", content: "c", done: true }));

    const seqs = (calls as Array<{ type: string; payload: { seq: number } }>)
      .filter((c) => c.type === "stream.event")
      .map((c) => c.payload.seq);
    expect(seqs).toEqual([0, 1, 2]);
  });

  // SP-4 — done=true removes the enricher so the next event for the same execution resets seq
  test("SP-4: done=true removes enricher and next event for same execution starts seq at 0", () => {
    proc.onStreamEvent(makeStreamEvent({ type: "assistant", content: "first", done: true }));

    calls.length = 0;

    proc.onStreamEvent(makeStreamEvent({ conversationId: 2, type: "assistant", content: "second", done: true }));

    const secondBroadcast = calls[0] as { type: string; payload: { seq: number } };
    expect(secondBroadcast.payload.seq).toBe(0);
  });

  // SP-5 — Two parallel executions have independent seq counters
  test("SP-5: parallel executions have independent seq counters", () => {
    proc.onStreamEvent(makeStreamEvent({ executionId: 10, type: "assistant", content: "a10" }));
    proc.onStreamEvent(makeStreamEvent({ executionId: 20, type: "assistant", content: "a20" }));
    proc.onStreamEvent(makeStreamEvent({ executionId: 10, type: "assistant", content: "b10" }));
    proc.onStreamEvent(makeStreamEvent({ executionId: 20, type: "assistant", content: "b20" }));
    proc.onStreamEvent(makeStreamEvent({ executionId: 10, type: "assistant", content: "c10", done: true }));
    proc.onStreamEvent(makeStreamEvent({ executionId: 20, type: "assistant", content: "c20", done: true }));

    const broadcastSeqsByExecution = (calls as Array<{ type: string; payload: { executionId: number; seq: number } }>)
      .filter((c) => c.type === "stream.event")
      .reduce<Record<number, number[]>>((acc, c) => {
        const eid = c.payload.executionId;
        (acc[eid] ??= []).push(c.payload.seq);
        return acc;
      }, {});

    expect(broadcastSeqsByExecution[10]).toEqual([0, 1, 2]);
    expect(broadcastSeqsByExecution[20]).toEqual([0, 1, 2]);
  });

  // SP-6 — Claude text_delta broadcasts text_chunk
  test("SP-6: Claude text_delta raw message broadcasts text_chunk immediately", () => {
    proc.onRawMessageEnqueued(makeClaudeDelta("hello") as any);
    expect(calls).toHaveLength(1);
    const msg = calls[0] as { type: string; payload: { type: string; content: string } };
    expect(msg.type).toBe("stream.event");
    expect(msg.payload.type).toBe("text_chunk");
    expect(msg.payload.content).toBe("hello");
  });

  // SP-7 — Claude thinking_delta broadcasts reasoning_chunk
  test("SP-7: Claude thinking_delta raw message broadcasts reasoning_chunk immediately", () => {
    proc.onRawMessageEnqueued(makeClaudeThinkingDelta("hmm...") as any);
    expect(calls).toHaveLength(1);
    const msg = calls[0] as { type: string; payload: { type: string; content: string } };
    expect(msg.type).toBe("stream.event");
    expect(msg.payload.type).toBe("reasoning_chunk");
    expect(msg.payload.content).toBe("hmm...");
  });

  // SP-8 — Copilot assistant.message_delta broadcasts text_chunk
  test("SP-8: Copilot assistant.message_delta broadcasts text_chunk immediately", () => {
    proc.onRawMessageEnqueued(makeCopilotMessageDelta("world") as any);
    expect(calls).toHaveLength(1);
    const msg = calls[0] as { type: string; payload: { type: string; content: string } };
    expect(msg.type).toBe("stream.event");
    expect(msg.payload.type).toBe("text_chunk");
    expect(msg.payload.content).toBe("world");
  });

  // SP-9 — setMarkClaudeExecution spy is called for qualifying raw deltas
  test("SP-9: setMarkClaudeExecution fn is called with executionId for qualifying deltas", () => {
    const markedIds: number[] = [];
    proc.setMarkClaudeExecution((id) => markedIds.push(id));

    proc.onRawMessageEnqueued(makeClaudeDelta("text", 42) as any);
    expect(markedIds).toEqual([42]);
  });

  // SP-10 — setMarkClaudeExecution not set yet: no error thrown
  test("SP-10: qualifying raw delta before setMarkClaudeExecution is a no-op (no error)", () => {
    expect(() => {
      proc.onRawMessageEnqueued(makeClaudeDelta("text", 99) as any);
    }).not.toThrow();
  });
});
