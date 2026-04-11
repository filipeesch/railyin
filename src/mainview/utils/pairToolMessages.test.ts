import { describe, test, expect } from "bun:test";
import { pairToolMessages } from "./pairToolMessages";
import type { ConversationMessage } from "../../shared/rpc-types";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let _id = 1;

function makeCall(callId: string, opts: {
  parentCallId?: string;
  name?: string;
  args?: Record<string, unknown>;
} = {}): ConversationMessage {
  return {
    id: _id++,
    taskId: 1,
    conversationId: 1,
    type: "tool_call",
    role: null,
    content: JSON.stringify({
      type: "function",
      function: { name: opts.name ?? "read_file", arguments: JSON.stringify(opts.args ?? {}) },
      id: callId,
    }),
    metadata: opts.parentCallId ? { parent_tool_call_id: opts.parentCallId } : null,
    createdAt: new Date().toISOString(),
  };
}

function makeResult(callId: string): ConversationMessage {
  return {
    id: _id++,
    taskId: 1,
    conversationId: 1,
    type: "tool_result",
    role: null,
    content: JSON.stringify({ type: "tool_result", tool_use_id: callId, content: "ok" }),
    metadata: { tool_call_id: callId },
    createdAt: new Date().toISOString(),
  };
}

function makeDiff(callId: string): ConversationMessage {
  return {
    id: _id++,
    taskId: 1,
    conversationId: 1,
    type: "file_diff",
    role: null,
    content: JSON.stringify({ operation: "write_file", path: "foo.ts" }),
    metadata: { tool_call_id: callId },
    createdAt: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pairToolMessages", () => {
  // 3.2 Sequential: 1 call, 1 result
  test("sequential — 1 call and 1 result are correctly paired", () => {
    const call = makeCall("call_A");
    const result = makeResult("call_A");
    const entries = pairToolMessages([call, result]);
    expect(entries).toHaveLength(1);
    expect(entries[0].call).toBe(call);
    expect(entries[0].result).toBe(result);
    expect(entries[0].diff).toBeNull();
    expect(entries[0].children).toHaveLength(0);
  });

  // 3.3 Batched: 4 calls then 4 results (task-32 pattern)
  test("batched — 4 calls followed by 4 results all pair correctly", () => {
    const calls   = ["A", "B", "C", "D"].map((id) => makeCall(`call_${id}`));
    const results = ["A", "B", "C", "D"].map((id) => makeResult(`call_${id}`));
    const msgs = [...calls, ...results];
    const entries = pairToolMessages(msgs);
    expect(entries).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(entries[i].call).toBe(calls[i]);
      expect(entries[i].result).toBe(results[i]);
    }
  });

  // 3.4 Batched with file_diff
  test("batched with file_diff — each call paired with correct result and diff", () => {
    const calls   = ["A", "B"].map((id) => makeCall(`call_${id}`));
    const results = ["A", "B"].map((id) => makeResult(`call_${id}`));
    const diffs   = ["A", "B"].map((id) => makeDiff(`call_${id}`));
    const entries = pairToolMessages([...calls, ...results, ...diffs]);
    expect(entries).toHaveLength(2);
    expect(entries[0].diff).toBe(diffs[0]);
    expect(entries[1].diff).toBe(diffs[1]);
  });

  // 3.5 Orphaned result (no matching call)
  test("orphaned result — dropped silently, no crash", () => {
    const call = makeCall("call_A");
    const orphanResult = makeResult("call_Z");
    const entries = pairToolMessages([call, orphanResult]);
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBeNull();
  });

  // 3.6 Orphaned call (no result)
  test("orphaned call — entry has result: null", () => {
    const call = makeCall("call_A");
    const entries = pairToolMessages([call]);
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBeNull();
    expect(entries[0].diff).toBeNull();
  });

  // 3.7 Subagent nesting
  test("subagent nesting — child tools nested under spawn_agent, top-level has only spawn_agent", () => {
    const spawnCall = makeCall("call_SPAWN", { name: "spawn_agent" });
    const child1 = makeCall("call_C1", { parentCallId: "call_SPAWN" });
    const child2 = makeCall("call_C2", { parentCallId: "call_SPAWN" });
    const child3 = makeCall("call_C3", { parentCallId: "call_SPAWN" });
    const spawnResult = makeResult("call_SPAWN");
    const r1 = makeResult("call_C1");
    const r2 = makeResult("call_C2");
    const r3 = makeResult("call_C3");

    const entries = pairToolMessages([spawnCall, child1, child2, child3, spawnResult, r1, r2, r3]);
    expect(entries).toHaveLength(1);
    expect(entries[0].call).toBe(spawnCall);
    expect(entries[0].result).toBe(spawnResult);
    expect(entries[0].children).toHaveLength(3);
    expect(entries[0].children[0].call).toBe(child1);
    expect(entries[0].children[1].call).toBe(child2);
    expect(entries[0].children[2].call).toBe(child3);
  });

  // 3.8 Unparseable tool_call content
  test("unparseable tool_call content — entry with result: null, no crash", () => {
    const badCall: ConversationMessage = {
      id: _id++,
      taskId: 1,
      conversationId: 1,
      type: "tool_call",
      role: null,
      content: "{{not json}}",
      metadata: null,
      createdAt: new Date().toISOString(),
    };
    const entries = pairToolMessages([badCall]);
    expect(entries).toHaveLength(1);
    expect(entries[0].call).toBe(badCall);
    expect(entries[0].result).toBeNull();
    expect(entries[0].diff).toBeNull();
  });
});
