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

  it("S-7: loadOlderMessages is a no-op when isLoadingOlder is true (guard)", async () => {
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

