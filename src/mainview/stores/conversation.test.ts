import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

const { useConversationStore } = await import("./conversation");

function makeMsg(id: number, conversationId: number, content = `msg-${id}`) {
  return {
    id,
    taskId: null,
    conversationId,
    type: "assistant" as const,
    role: "assistant" as const,
    content,
    metadata: null,
    createdAt: new Date().toISOString(),
  };
}

describe("conversationStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => ({ messages: [], hasMore: false }));
  });

  it("only appends pushed messages for the active conversation", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    store.onNewMessage({
      id: 1,
      taskId: 2,
      conversationId: 2,
      type: "assistant",
      role: "assistant",
      content: "other",
      metadata: null,
      createdAt: new Date().toISOString(),
    });
    store.onNewMessage({
      id: 2,
      taskId: 1,
      conversationId: 1,
      type: "assistant",
      role: "assistant",
      content: "active",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]?.content).toBe("active");
  });

  it("refreshes context usage when the active conversation stream completes", async () => {
    const store = useConversationStore();
    store.setActiveConversation(42);
    apiMock.mockImplementation((async (method: string) => {
      if (method === "conversations.getMessages") return { messages: [], hasMore: false };
      if (method === "conversations.contextUsage") return { usedTokens: 10, maxTokens: 100, fraction: 0.1 };
      return [];
    }) as any);

    store.onStreamEvent({
      taskId: null,
      conversationId: 42,
      executionId: 5,
      seq: 1,
      blockId: "done-1",
      type: "done",
      content: "",
      metadata: null,
      parentBlockId: null,
      subagentId: null,
      done: true,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(apiMock).toHaveBeenCalledWith("conversations.contextUsage", { conversationId: 42 });
    expect(store.contextUsage).toEqual({ usedTokens: 10, maxTokens: 100, fraction: 0.1 });
  });

  // ─── Pagination store tests ────────────────────────────────────────────────

  it("S-1: loadMessages sets hasMoreBefore from wrapped response", async () => {
    const store = useConversationStore();
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(10, 1), makeMsg(11, 1)],
      hasMore: true,
    }));

    await store.loadMessages({ conversationId: 1 });

    expect(store.messages).toHaveLength(2);
    expect(store.hasMoreBefore).toBe(true);
  });

  it("S-2: loadMessages sets hasMoreBefore false when no more", async () => {
    const store = useConversationStore();
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(1, 1)],
      hasMore: false,
    }));

    await store.loadMessages({ conversationId: 1 });

    expect(store.hasMoreBefore).toBe(false);
  });

  it("S-3: loadMessages sorts messages ascending by id", async () => {
    const store = useConversationStore();
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(3, 1), makeMsg(1, 1), makeMsg(2, 1)],
      hasMore: false,
    }));

    await store.loadMessages({ conversationId: 1 });

    expect(store.messages.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("S-4: loadOlderMessages prepends older messages and updates hasMoreBefore", async () => {
    const store = useConversationStore();
    // Seed initial page (ids 6-10, hasMore true)
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(6, 1), makeMsg(7, 1), makeMsg(8, 1), makeMsg(9, 1), makeMsg(10, 1)],
      hasMore: true,
    }));
    await store.loadMessages({ conversationId: 1 });

    // Now loadOlderMessages should fetch beforeMessageId=6
    apiMock.mockImplementation((async (method: string, params: Record<string, unknown>) => {
      if (method === "conversations.getMessages") {
        expect((params as Record<string, unknown>).beforeMessageId).toBe(6);
        return {
          messages: [makeMsg(1, 1), makeMsg(2, 1), makeMsg(3, 1), makeMsg(4, 1), makeMsg(5, 1)],
          hasMore: false,
        };
      }
      return { messages: [], hasMore: false };
    }) as any);

    await store.loadOlderMessages({ conversationId: 1 });

    expect(store.messages).toHaveLength(10);
    expect(store.messages[0].id).toBe(1);
    expect(store.messages[9].id).toBe(10);
    expect(store.hasMoreBefore).toBe(false);
  });

  it("S-5: loadOlderMessages is a no-op when hasMoreBefore is false", async () => {
    const store = useConversationStore();
    apiMock.mockImplementation(async () => ({ messages: [makeMsg(1, 1)], hasMore: false }));
    await store.loadMessages({ conversationId: 1 });

    const callsBefore = apiMock.mock.calls.length;
    await store.loadOlderMessages({ conversationId: 1 });

    expect(apiMock.mock.calls.length).toBe(callsBefore); // no extra calls
  });

  it("S-6: loadOlderMessages is a no-op when isLoadingOlder is true (guard)", async () => {
    const store = useConversationStore();
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(5, 1), makeMsg(6, 1)],
      hasMore: true,
    }));
    await store.loadMessages({ conversationId: 1 });

    // Force isLoadingOlder to true by making the api hang
    let resolve: () => void;
    const hanging = new Promise<{ messages: typeof store.messages; hasMore: boolean }>((r) => { resolve = () => r({ messages: [], hasMore: false }); });
    apiMock.mockImplementation(async () => hanging);

    const p1 = store.loadOlderMessages({ conversationId: 1 });
    const callsAfterFirst = apiMock.mock.calls.length;

    // Second call should be a no-op
    const p2 = store.loadOlderMessages({ conversationId: 1 });
    expect(apiMock.mock.calls.length).toBe(callsAfterFirst); // no second api call

    resolve!();
    await p1;
    await p2;
  });

  it("S-7: refreshLatestPage merges old history with new page (no rewind)", async () => {
    const store = useConversationStore();
    // Initial load: 5 messages, hasMore true
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(6, 1), makeMsg(7, 1), makeMsg(8, 1), makeMsg(9, 1), makeMsg(10, 1)],
      hasMore: true,
    }));
    await store.loadMessages({ conversationId: 1 });

    // Load older so we have ids 1-10
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(1, 1), makeMsg(2, 1), makeMsg(3, 1), makeMsg(4, 1), makeMsg(5, 1)],
      hasMore: false,
    }));
    await store.loadOlderMessages({ conversationId: 1 });

    // refreshLatestPage: stream done, returns new page 6-11
    apiMock.mockImplementation(async () => ({
      messages: [makeMsg(6, 1), makeMsg(7, 1), makeMsg(8, 1), makeMsg(9, 1), makeMsg(10, 1), makeMsg(11, 1)],
      hasMore: true,
    }));
    await store.refreshLatestPage({ conversationId: 1 });

    // Should have ids 1-11: old history (1-5) + new page (6-11)
    expect(store.messages).toHaveLength(11);
    expect(store.messages[0].id).toBe(1);
    expect(store.messages[10].id).toBe(11);
  });

  it("S-8: setActiveConversation(null) resets hasMoreBefore and isLoadingOlder", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);
    // Manually exercise the reset path
    store.setActiveConversation(null);

    expect(store.hasMoreBefore).toBe(false);
    expect(store.isLoadingOlder).toBe(false);
    expect(store.messages).toHaveLength(0);
  });
});

// ─── Stream block state suite (SB-1…SB-10) ───────────────────────────────────

function makeStreamEvent(
  conversationId: number,
  type: import("@shared/rpc-types").StreamEventType,
  overrides: Partial<import("@shared/rpc-types").StreamEvent> = {},
): import("@shared/rpc-types").StreamEvent {
  return {
    taskId: 1,
    conversationId,
    executionId: 1,
    seq: 1,
    blockId: `block-${type}-1`,
    type,
    content: `content-${type}`,
    metadata: null,
    parentBlockId: null,
    subagentId: null,
    done: false,
    ...overrides,
  };
}

describe("stream block state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => ({ messages: [], hasMore: false }));
  });

  it("SB-1: first text_chunk creates stream state entry; Map instance is populated", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);
    const mapRef = store.streamStates;

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { content: "hello", seq: 1, blockId: "b1" }));

    const state = store.streamStates.get(1);
    expect(state).toBeDefined();
    expect(state!.roots).toHaveLength(1);
    const block = state!.blocks.get(state!.roots[0]);
    expect(block).toBeDefined();
    expect(block!.content).toBe("hello");
    expect(store.streamStates).toBe(mapRef); // same Map instance
  });

  it("SB-2: second text_chunk appends to existing block (concatenation)", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { content: "foo", seq: 1, blockId: "b1" }));
    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { content: "bar", seq: 2, blockId: "b2" }));

    const state = store.streamStates.get(1)!;
    // Still only one root block — second chunk appended to first
    expect(state.roots).toHaveLength(1);
    const block = state.blocks.get(state.roots[0])!;
    expect(block.content).toBe("foobar");
  });

  // REGRESSION SENTINEL: This test verifies the Map-clone anti-pattern is gone.
  // It WOULD FAIL if `streamStates.value = new Map(streamStates.value)` was restored.
  it("SB-3: streamStates.value is the SAME Map instance after two events (no clone)", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);
    const mapRef = store.streamStates;

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 1, blockId: "b1" }));
    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 2, blockId: "b2" }));

    expect(store.streamStates).toBe(mapRef);
  });

  it("SB-4: tool_call event creates block with correct blockId and type", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    store.onStreamEvent(
      makeStreamEvent(1, "tool_call", {
        blockId: "tool-block-1",
        content: "bash",
        metadata: JSON.stringify({ tool: "bash", tool_call_id: "tc1" }),
      }),
    );

    const state = store.streamStates.get(1)!;
    const block = state.blocks.get("tool-block-1");
    expect(block).toBeDefined();
    expect(block!.blockId).toBe("tool-block-1");
    expect(block!.type).toBe("tool_call");
  });

  it("SB-4b: tool_call block starts as pending (done=false) until tool_result arrives", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    store.onStreamEvent(
      makeStreamEvent(1, "tool_call", {
        blockId: "tc-pending",
        content: "bash",
        metadata: JSON.stringify({ tool: "bash", tool_call_id: "tcp1" }),
      }),
    );

    const state = store.streamStates.get(1)!;
    const block = state.blocks.get("tc-pending")!;
    expect(block.done).toBe(false);

    // tool_result arrives → block should be marked done
    store.onStreamEvent(
      makeStreamEvent(1, "tool_result", {
        blockId: "tc-pending",
        content: "exit 0",
        metadata: null,
      }),
    );
    expect(block.done).toBe(true);
  });

  it("SB-5: done for NON-active conversation removes the stream state entirely", () => {
    const store = useConversationStore();
    store.setActiveConversation(99); // different conversation is active

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 1 }));
    store.onStreamEvent(
      makeStreamEvent(1, "done", { seq: 2, blockId: "done-1", content: "", done: true }),
    );

    expect(store.streamStates.get(1)).toBeUndefined();
  });

  it("SB-6: done for ACTIVE conversation does NOT clear blocks", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 1 }));
    store.onStreamEvent(
      makeStreamEvent(1, "done", { seq: 2, blockId: "done-1", content: "", done: true }),
    );

    const state = store.streamStates.get(1)!;
    expect(state.isDone).toBe(true);
    expect(state.blocks.size).toBeGreaterThan(0); // blocks preserved for active conversation
  });

  it("SB-7: contextUsageByConversation is mutated in place (same Map instance) after fetchContextUsage", async () => {
    const store = useConversationStore();
    store.setActiveConversation(42);
    const mapRef = store.contextUsageByConversation;

    apiMock.mockImplementation((async (method: string) => {
      if (method === "conversations.contextUsage")
        return { usedTokens: 5, maxTokens: 100, fraction: 0.05 };
      return { messages: [], hasMore: false };
    }) as any);

    await store.fetchContextUsage({ conversationId: 42 });

    expect(store.contextUsageByConversation).toBe(mapRef);
    expect(store.contextUsageByConversation.get(42)).toEqual({
      usedTokens: 5,
      maxTokens: 100,
      fraction: 0.05,
    });
  });

  it("SB-8: setActiveConversation deletes previous conversation's contextUsageByConversation entry", async () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    apiMock.mockImplementation((async (method: string) => {
      if (method === "conversations.contextUsage")
        return { usedTokens: 10, maxTokens: 100, fraction: 0.1 };
      return { messages: [], hasMore: false };
    }) as any);
    await store.fetchContextUsage({ conversationId: 1 });
    expect(store.contextUsageByConversation.has(1)).toBe(true);

    store.setActiveConversation(2); // switch away from conversation 1
    expect(store.contextUsageByConversation.has(1)).toBe(false);
  });

  it("SB-9: stream state is removed from streamStates after done for non-active conversation", () => {
    const store = useConversationStore();
    store.setActiveConversation(99);

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 1 }));
    store.onStreamEvent(
      makeStreamEvent(1, "done", { seq: 2, blockId: "done-1", content: "", done: true }),
    );

    expect(store.streamStates.get(1)).toBeUndefined();
  });

  it("SB-10: concurrent streams for two conversations are independent", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { content: "A1", seq: 1, blockId: "b1" }));
    store.onStreamEvent(makeStreamEvent(2, "text_chunk", { content: "B1", seq: 1, blockId: "b1" }));
    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { content: "A2", seq: 2, blockId: "b2" }));
    store.onStreamEvent(makeStreamEvent(2, "text_chunk", { content: "B2", seq: 2, blockId: "b2" }));

    const stateA = store.streamStates.get(1)!;
    const stateB = store.streamStates.get(2)!;

    const blockA = stateA.blocks.get(stateA.roots[0])!;
    const blockB = stateB.blocks.get(stateB.roots[0])!;

    expect(blockA.content).toBe("A1A2");
    expect(blockB.content).toBe("B1B2");
    expect(stateA.roots).toHaveLength(1);
    expect(stateB.roots).toHaveLength(1);
  });

  it("SB-11: two subagent bubbles each nest their own child even when raw child callIds collide", () => {
    // REGRESSION: parallel delegate children (local models reuse ids like "call_0")
    // emit colliding child tool callIds. The backend namespaces the live blockId by the
    // parent bubble (`<bubble>::<callId>`); the store keys blocks by that namespaced id,
    // so both siblings must nest instead of one being silently dropped.
    const store = useConversationStore();
    store.setActiveConversation(1);

    // Two subagent bubbles (root-level tool_call containers).
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble-a", content: "subagent", subagentId: "bubble-a" }));
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble-b", content: "subagent", subagentId: "bubble-b" }));

    // Each child's tool_call uses the SAME raw callId ("call_0") but a parent-namespaced blockId.
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble-a::call_0", parentBlockId: "bubble-a", content: "read_file" }));
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble-b::call_0", parentBlockId: "bubble-b", content: "read_file" }));

    const state = store.streamStates.get(1)!;
    const bubbleA = state.blocks.get("bubble-a")!;
    const bubbleB = state.blocks.get("bubble-b")!;

    expect(bubbleA.children).toEqual(["bubble-a::call_0"]);
    expect(bubbleB.children).toEqual(["bubble-b::call_0"]);

    // Each child's tool_result (mirrored namespacing) marks the right child done.
    store.onStreamEvent(makeStreamEvent(1, "tool_result", { blockId: "bubble-a::call_0", parentBlockId: "bubble-a", content: "a" }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", { blockId: "bubble-b::call_0", parentBlockId: "bubble-b", content: "b" }));

    expect(state.blocks.get("bubble-a::call_0")!.done).toBe(true);
    expect(state.blocks.get("bubble-b::call_0")!.done).toBe(true);
  });

  it("SB-13: single subagent bubble appears with correct done status after tool_result", () => {
    // REGRESSION: single web_search agent's subagent bubble doesn't appear
    const store = useConversationStore();
    store.setActiveConversation(1);

    // web_search tool_call
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "tc-1",
      content: JSON.stringify({ type: "function", function: { name: "web_search", arguments: "{}" } }),
    }));

    // subagent_start → tool_call with subagentId
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "sa-1",
      content: JSON.stringify({ type: "function", function: { name: "subagent", arguments: '{"intent":"web-search"}' } }),
      subagentId: "sa-1",
    }));

    // subagent_stop → tool_result with done=true and subagentId
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "sa-1",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "sa-1", content: "## Answer\nFound it." }),
      metadata: JSON.stringify({ resultContent: "## Answer\nFound it.", isError: false }),
      subagentId: "sa-1",
      done: true,
    }));

    const state = store.streamStates.get(1)!;
    const saBlock = state.blocks.get("sa-1")!;

    // The subagent bubble should exist and be marked done
    expect(saBlock).toBeDefined();
    expect(saBlock.type).toBe("tool_call");
    expect(saBlock.done).toBe(true);
    expect(saBlock.metadata).toContain("resultContent");
    expect(saBlock.children).toEqual([]);

    // The subagent bubble should be in the roots (not nested under web_search)
    expect(state.roots).toContain("sa-1");
  });

  it("SB-12: single subagent bubble nests BOTH sequential child calls when raw callId is reused", () => {
    // REGRESSION (single task): a single delegate child (local models like Qwen) emits the
    // SAME raw callId ("call_0") for two SEQUENTIAL tool calls. The backend gives each
    // occurrence a distinct live blockId (`<bubble>::<callId>::<seq>`); the store keys blocks
    // by that id, so BOTH calls must nest under the bubble instead of the second being dropped.
    const store = useConversationStore();
    store.setActiveConversation(1);

    // One subagent bubble.
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble", content: "subagent", subagentId: "bubble" }));

    // First child tool call: occurrence 1.
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble::call_0::1", parentBlockId: "bubble", content: "read_file" }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", { blockId: "bubble::call_0::1", parentBlockId: "bubble", content: "first" }));

    // Second child tool call REUSES the raw callId but is a distinct occurrence.
    store.onStreamEvent(makeStreamEvent(1, "tool_call", { blockId: "bubble::call_0::2", parentBlockId: "bubble", content: "read_file" }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", { blockId: "bubble::call_0::2", parentBlockId: "bubble", content: "second" }));

    const state = store.streamStates.get(1)!;
    const bubble = state.blocks.get("bubble")!;

    // Both occurrences nested under the bubble — the second is NOT silently dropped.
    expect(bubble.children).toEqual(["bubble::call_0::1", "bubble::call_0::2"]);

    // Each result resolved its own occurrence.
    expect(state.blocks.get("bubble::call_0::1")!.done).toBe(true);
    expect(state.blocks.get("bubble::call_0::2")!.done).toBe(true);
  });

  it("SB-NEW-1: onNewMessage with compaction_summary on active conversation → fetchContextUsage called", async () => {
    const store = useConversationStore();
    store.setActiveConversation(42);
    apiMock.mockImplementation((async (method: string) => {
      if (method === "conversations.contextUsage") return { usedTokens: 5, maxTokens: 100, fraction: 0.05 };
      if (method === "conversations.getMessages") return { messages: [], hasMore: false };
      return [];
    }) as any);

    store.onNewMessage({
      id: 99,
      taskId: null,
      conversationId: 42,
      type: "compaction_summary",
      role: null,
      content: "Compacted.",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(apiMock).toHaveBeenCalledWith("conversations.contextUsage", { conversationId: 42 });
    expect(store.contextUsage).toEqual({ usedTokens: 5, maxTokens: 100, fraction: 0.05 });
  });

  it("SB-NEW-2: onNewMessage with compaction_summary on non-active conversation → fetchContextUsage NOT called", async () => {
    const store = useConversationStore();
    store.setActiveConversation(42);
    apiMock.mockClear();

    store.onNewMessage({
      id: 100,
      taskId: null,
      conversationId: 99,
      type: "compaction_summary",
      role: null,
      content: "Other conv.",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    await Promise.resolve();

    const contextUsageCalls = apiMock.mock.calls.filter(([method]) => method === "conversations.contextUsage");
    expect(contextUsageCalls).toHaveLength(0);
  });

  it("SB-TRACE-1: trace store state at each step of single subagent event flow", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    // Simulate the exact IPC event flow from the debug test:
    // [0] tool_call tc-1 (web_search)
    // [1] tool_call sa-1 (subagent)
    // [2] tool_result sa-1 (subagent result)
    // [3] tool_result tc-1 (web_search result)
    // [4] done

    // Step 0: web_search tool_call
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "tc-1",
      content: JSON.stringify({ type: "function", function: { name: "web_search", arguments: '{"prompt":"test"}' } }),
    }));
    {
      const state = store.streamStates.get(1)!;
      const tc1 = state.blocks.get("tc-1");
      console.log("[TRACE 0] web_search tool_call:", {
        roots: state.roots,
        blockType: tc1?.type,
        blockDone: tc1?.done,
        blocksCount: state.blocks.size,
      });
      expect(state.roots).toContain("tc-1");
      expect(tc1?.type).toBe("tool_call");
      expect(tc1?.done).toBe(false);
    }

    // Step 1: subagent_start → tool_call sa-1
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "sa-1",
      content: JSON.stringify({ type: "function", function: { name: "subagent", arguments: '{"intent":"web-search","prompt":"test"}' } }),
      subagentId: "sa-1",
    }));
    {
      const state = store.streamStates.get(1)!;
      const sa1 = state.blocks.get("sa-1");
      console.log("[TRACE 1] subagent tool_call:", {
        roots: state.roots,
        blockType: sa1?.type,
        blockDone: sa1?.done,
        blocksCount: state.blocks.size,
        contentPreview: sa1?.content?.slice(0, 80),
      });
      expect(state.roots).toContain("sa-1");
      expect(sa1?.type).toBe("tool_call");
      expect(sa1?.done).toBe(false);
    }

    // Step 2: subagent_stop → tool_result sa-1
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "sa-1",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "sa-1", content: "## Answer\nFound it." }),
      metadata: JSON.stringify({ resultContent: "## Answer\nFound it.", isError: false }),
      subagentId: "sa-1",
      done: true,
    }));
    {
      const state = store.streamStates.get(1)!;
      const sa1 = state.blocks.get("sa-1");
      console.log("[TRACE 2] subagent tool_result:", {
        roots: state.roots,
        blockType: sa1?.type,
        blockDone: sa1?.done,
        metadata: sa1?.metadata?.slice(0, 80),
        blocksCount: state.blocks.size,
      });
      expect(state.roots).toContain("sa-1");
      expect(sa1?.type).toBe("tool_call");
      expect(sa1?.done).toBe(true);
      expect(sa1?.metadata).toContain("resultContent");
    }

    // Step 3: web_search result → tool_result tc-1
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "tc-1",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "tc-1", content: "## Answer\nFound it." }),
      metadata: JSON.stringify({ tool_call_id: "tc-1" }),
      done: false,
    }));
    {
      const state = store.streamStates.get(1)!;
      const sa1 = state.blocks.get("sa-1");
      const tc1 = state.blocks.get("tc-1");
      console.log("[TRACE 3] web_search tool_result:", {
        roots: state.roots,
        sa1Type: sa1?.type,
        sa1Done: sa1?.done,
        sa1Metadata: sa1?.metadata?.slice(0, 80),
        tc1Type: tc1?.type,
        tc1Done: tc1?.done,
        blocksCount: state.blocks.size,
      });
      // CRITICAL: subagent block must still be in roots and have correct type/done
      expect(state.roots).toContain("sa-1");
      expect(sa1?.type).toBe("tool_call");
      expect(sa1?.done).toBe(true);
      expect(sa1?.metadata).toContain("resultContent");
    }

    // Step 4: done
    store.onStreamEvent(makeStreamEvent(1, "done", {
      blockId: "1-done",
      content: "",
      done: true,
    }));
    {
      const state = store.streamStates.get(1)!;
      const sa1 = state.blocks.get("sa-1");
      console.log("[TRACE 4] done:", {
        roots: state.roots,
        isDone: state.isDone,
        sa1Type: sa1?.type,
        sa1Done: sa1?.done,
        sa1Metadata: sa1?.metadata?.slice(0, 80),
        blocksCount: state.blocks.size,
      });
      // CRITICAL: subagent block must still exist after done
      expect(state.roots).toContain("sa-1");
      expect(sa1?.type).toBe("tool_call");
      expect(sa1?.done).toBe(true);
      expect(sa1?.metadata).toContain("resultContent");
    }
  });

  it("SB-TRACE-2: trace store state for multiple subagents event flow", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    // Simulate multiple subagent event flow
    // [0] tool_call tc-1
    // [1] tool_call tc-2
    // [2] tool_call sa-1
    // [3] tool_call sa-2
    // [4] tool_result sa-1
    // [5] tool_result sa-2
    // [6] tool_result tc-1
    // [7] tool_result tc-2
    // [8] done

    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "tc-1",
      content: JSON.stringify({ type: "function", function: { name: "web_search", arguments: '{"prompt":"A"}' } }),
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "tc-2",
      content: JSON.stringify({ type: "function", function: { name: "web_search", arguments: '{"prompt":"B"}' } }),
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "sa-1",
      content: JSON.stringify({ type: "function", function: { name: "subagent", arguments: '{"intent":"search-A","prompt":"A"}' } }),
      subagentId: "sa-1",
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_call", {
      blockId: "sa-2",
      content: JSON.stringify({ type: "function", function: { name: "subagent", arguments: '{"intent":"search-B","prompt":"B"}' } }),
      subagentId: "sa-2",
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "sa-1",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "sa-1", content: "Result A." }),
      metadata: JSON.stringify({ resultContent: "Result A.", isError: false }),
      subagentId: "sa-1",
      done: true,
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "sa-2",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "sa-2", content: "Result B." }),
      metadata: JSON.stringify({ resultContent: "Result B.", isError: false }),
      subagentId: "sa-2",
      done: true,
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "tc-1",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "tc-1", content: "Result A." }),
      metadata: JSON.stringify({ tool_call_id: "tc-1" }),
      done: false,
    }));
    store.onStreamEvent(makeStreamEvent(1, "tool_result", {
      blockId: "tc-2",
      content: JSON.stringify({ type: "tool_result", tool_use_id: "tc-2", content: "Result B." }),
      metadata: JSON.stringify({ tool_call_id: "tc-2" }),
      done: false,
    }));
    store.onStreamEvent(makeStreamEvent(1, "done", {
      blockId: "1-done",
      content: "",
      done: true,
    }));

    const state = store.streamStates.get(1)!;
    console.log("[TRACE MULTI] final state:", {
      roots: state.roots,
      isDone: state.isDone,
      blocksCount: state.blocks.size,
    });
    for (const [id, block] of state.blocks) {
      console.log(`  block ${id}: type=${block.type}, done=${block.done}, metadata=${block.metadata?.slice(0, 50)}`);
    }

    // Both subagent blocks should be in roots
    expect(state.roots).toContain("sa-1");
    expect(state.roots).toContain("sa-2");
    expect(state.blocks.get("sa-1")?.type).toBe("tool_call");
    expect(state.blocks.get("sa-2")?.type).toBe("tool_call");
    expect(state.blocks.get("sa-1")?.done).toBe(true);
    expect(state.blocks.get("sa-2")?.done).toBe(true);
  });

  it("SB-NEW-3: streamStates Map does not retain entries for non-active conversations after done", () => {
    const store = useConversationStore();
    store.setActiveConversation(1);

    // Simulate 10 background conversations receiving events and completing
    for (let convId = 100; convId < 110; convId++) {
      store.onStreamEvent(makeStreamEvent(convId, "text_chunk", { seq: 1 }));
      store.onStreamEvent(
        makeStreamEvent(convId, "done", { seq: 2, blockId: `done-${convId}`, content: "", done: true }),
      );
    }

    // None of the background conversation states should remain in the Map
    for (let convId = 100; convId < 110; convId++) {
      expect(store.streamStates.get(convId)).toBeUndefined();
    }
    // The active conversation state is unaffected (not in map since no events sent)
    expect(store.streamStates.size).toBe(0);
  });
});

