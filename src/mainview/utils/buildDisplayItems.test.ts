import { describe, test, expect } from "vitest";
import { buildDisplayItems } from "./buildDisplayItems";
import type { ConversationMessage } from "../../shared/rpc-types";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let _id = 1000;

function makeMsg(
  type: ConversationMessage["type"],
  opts: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: _id++,
    taskId: 1,
    conversationId: 1,
    type,
    role: type === "user" ? "user" : type === "assistant" ? "assistant" : null,
    content: opts.content ?? "",
    metadata: opts.metadata ?? null,
    createdAt: new Date().toISOString(),
    ...opts,
  };
}

function makeToolCall(callId: string, parentCallId?: string): ConversationMessage {
  return makeMsg("tool_call", {
    content: JSON.stringify({
      type: "function",
      function: { name: "read_file", arguments: JSON.stringify({}) },
      id: callId,
    }),
    metadata: parentCallId ? { parent_tool_call_id: parentCallId } : null,
  });
}

function makeToolResult(callId: string): ConversationMessage {
  return makeMsg("tool_result", {
    content: JSON.stringify({ tool_use_id: callId, content: "ok" }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildDisplayItems", () => {
  // Orphaned children must not be dropped
  test("orphaned tool_call children (parent absent) produce tool_entry items", () => {
    const c1 = makeToolCall("tc-1", "missing-parent");
    const c2 = makeToolCall("tc-2", "missing-parent");
    const r1 = makeToolResult("tc-1");
    const r2 = makeToolResult("tc-2");

    const items = buildDisplayItems([c1, c2, r1, r2], false);
    expect(items.every((i) => i.kind === "tool_entry")).toBe(true);
    expect(items).toHaveLength(2);
  });

  // Regular assistant/user messages produce single items
  test("regular assistant and user messages produce single items", () => {
    const msgs = [
      makeMsg("assistant", { content: "Hello" }),
      makeMsg("user", { content: "Hi" }),
      makeMsg("assistant", { content: "How can I help?" }),
    ];

    const items = buildDisplayItems(msgs, false);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.kind === "single")).toBe(true);
  });

  // hasStreamTail appends a stream_tail sentinel
  test("hasStreamTail true appends stream_tail as last item", () => {
    const msgs = [makeMsg("assistant", { content: "Hey" })];

    const items = buildDisplayItems(msgs, true);
    expect(items).toHaveLength(2);
    expect(items[items.length - 1].kind).toBe("stream_tail");
  });

  // Tool block followed by assistant splits correctly
  test("tool block followed by assistant message — tool_entry then single", () => {
    const call = makeToolCall("tc-A");
    const result = makeToolResult("tc-A");
    const assistant = makeMsg("assistant", { content: "Done!" });

    const items = buildDisplayItems([call, result, assistant], false);
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("tool_entry");
    expect(items[1].kind).toBe("single");
  });

  // Empty input returns empty list (or stream_tail only when flagged)
  test("empty messages with hasStreamTail produces only stream_tail", () => {
    const items = buildDisplayItems([], true);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("stream_tail");
  });

  test("empty messages without hasStreamTail produces empty list", () => {
    const items = buildDisplayItems([], false);
    expect(items).toHaveLength(0);
  });
});
