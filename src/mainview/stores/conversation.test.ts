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
    apiMock.mockImplementation(async (method) => {
      if (method === "conversations.getMessages") return { messages: [], hasMore: false };
      if (method === "conversations.contextUsage") return { usedTokens: 10, maxTokens: 100, fraction: 0.1 };
      return [];
    });

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
    apiMock.mockImplementation(async (method, params: Record<string, unknown>) => {
      if (method === "conversations.getMessages") {
        expect((params as Record<string, unknown>).beforeMessageId).toBe(6);
        return {
          messages: [makeMsg(1, 1), makeMsg(2, 1), makeMsg(3, 1), makeMsg(4, 1), makeMsg(5, 1)],
          hasMore: false,
        };
      }
      return { messages: [], hasMore: false };
    });

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

  it("SB-5: done for NON-active conversation clears blocks/roots but retains shell with isDone:true", () => {
    const store = useConversationStore();
    store.setActiveConversation(99); // different conversation is active

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 1 }));
    store.onStreamEvent(
      makeStreamEvent(1, "done", { seq: 2, blockId: "done-1", content: "", done: true }),
    );

    const state = store.streamStates.get(1);
    expect(state).toBeDefined();
    expect(state!.isDone).toBe(true);
    expect(state!.blocks.size).toBe(0);
    expect(state!.roots).toHaveLength(0);
    expect(state!.executionId).toBe(1);
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

    apiMock.mockImplementation(async (method: string) => {
      if (method === "conversations.contextUsage")
        return { usedTokens: 5, maxTokens: 100, fraction: 0.05 };
      return { messages: [], hasMore: false };
    });

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

    apiMock.mockImplementation(async (method: string) => {
      if (method === "conversations.contextUsage")
        return { usedTokens: 10, maxTokens: 100, fraction: 0.1 };
      return { messages: [], hasMore: false };
    });
    await store.fetchContextUsage({ conversationId: 1 });
    expect(store.contextUsageByConversation.has(1)).toBe(true);

    store.setActiveConversation(2); // switch away from conversation 1
    expect(store.contextUsageByConversation.has(1)).toBe(false);
  });

  it("SB-9: stream state shell accessible via streamStates.get(id) after done for non-active", () => {
    const store = useConversationStore();
    store.setActiveConversation(99);

    store.onStreamEvent(makeStreamEvent(1, "text_chunk", { seq: 1 }));
    store.onStreamEvent(
      makeStreamEvent(1, "done", { seq: 2, blockId: "done-1", content: "", done: true }),
    );

    const shell = store.streamStates.get(1);
    expect(shell).toBeDefined();
    expect(shell!.isDone).toBe(true);
    expect(shell!.executionId).toBe(1);
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
});

