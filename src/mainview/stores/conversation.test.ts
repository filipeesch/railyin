import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createPinia, setActivePinia } from "pinia";

const apiMock = mock(async () => []);
mock.module("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

const { useConversationStore } = await import("./conversation");

describe("conversationStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => []);
  });

  it("keeps live tokens scoped to the active conversation", () => {
    const store = useConversationStore();

    store.setActiveConversation(1);
    store.onStreamToken({
      taskId: 2,
      conversationId: 2,
      executionId: 10,
      token: "foreign",
      done: false,
      isReasoning: false,
      isStatus: false,
    });

    expect(store.streamingConversationId).toBeNull();
    expect(store.streamingToken).toBe("");

    store.onStreamToken({
      taskId: 1,
      conversationId: 1,
      executionId: 11,
      token: "local",
      done: false,
      isReasoning: false,
      isStatus: false,
    });

    expect(store.streamingConversationId).toBe(1);
    expect(store.streamingToken).toBe("local");

    store.setActiveConversation(2);

    expect(store.streamingConversationId).toBe(2);
    expect(store.streamingToken).toBe("foreign");
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
      if (method === "conversations.getMessages") return [];
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
});
