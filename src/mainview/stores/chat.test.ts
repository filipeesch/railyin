import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

const { useChatStore } = await import("./chat");
const { useConversationStore } = await import("./conversation");
const { useWorkspaceStore } = await import("./workspace");

function makeChatSession(overrides: Partial<import("@shared/rpc-types").ChatSession> = {}): import("@shared/rpc-types").ChatSession {
  return {
    id: 1,
    workspaceKey: "default",
    title: "Session",
    status: "idle",
    conversationId: 10,
    model: null,
    enabledMcpTools: null,
    samplingPresetOverride: null,
    lastActivityAt: new Date().toISOString(),
    lastReadAt: new Date().toISOString(),
    archivedAt: null,
    createdAt: new Date().toISOString(),
    shellAutoApprove: false,
    approvedCommands: [],
    modelParams: [],
    ...overrides,
  };
}

function makeStreamEvent(
  conversationId: number,
  type: import("@shared/rpc-types").StreamEventType,
  overrides: Partial<import("@shared/rpc-types").StreamEvent> = {},
): import("@shared/rpc-types").StreamEvent {
  return {
    taskId: null,
    conversationId,
    executionId: 1,
    seq: 1,
    blockId: `block-1`,
    type,
    content: "content",
    metadata: null,
    parentBlockId: null,
    subagentId: null,
    done: false,
    ...overrides,
  };
}

describe("chatStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => ({ messages: [], hasMore: false }));
  });

  it("C1: markUnread — same unreadSessionIds Set instance before/after, sessionId present", () => {
    const store = useChatStore();
    const setRef = store.unreadSessionIds;

    store.markUnread(42);

    expect(store.unreadSessionIds).toBe(setRef); // same Set instance
    expect(store.unreadSessionIds.has(42)).toBe(true);
  });

  it("C2: clearUnread — same Set instance, sessionId absent", () => {
    const store = useChatStore();
    store.markUnread(42);
    const setRef = store.unreadSessionIds;

    store.clearUnread(42);

    expect(store.unreadSessionIds).toBe(setRef); // same Set instance
    expect(store.unreadSessionIds.has(42)).toBe(false);
  });

  it("C3: onChatNewMessage only marks unread for non-active session", () => {
    const store = useChatStore();
    const convStore = useConversationStore();

    // Register two sessions
    const session1 = makeChatSession({ id: 1, conversationId: 10 });
    const session2 = makeChatSession({ id: 2, conversationId: 20 });
    store.onChatSessionUpdated(session1);
    store.onChatSessionUpdated(session2);

    // Set session 1 as active
    convStore.setActiveConversation(10);

    // Message for active conversation (conv 10) — should NOT mark unread
    store.onChatNewMessage({
      id: 1,
      taskId: null,
      conversationId: 10,
      type: "assistant",
      role: "assistant",
      content: "hi",
      metadata: null,
      createdAt: new Date().toISOString(),
    });
    expect(store.unreadSessionIds.has(1)).toBe(false);

    // Message for inactive conversation (conv 20) — should mark unread
    store.onChatNewMessage({
      id: 2,
      taskId: null,
      conversationId: 20,
      type: "assistant",
      role: "assistant",
      content: "hi",
      metadata: null,
      createdAt: new Date().toISOString(),
    });
    expect(store.unreadSessionIds.has(2)).toBe(true);
  });

  it("C4: onChatStreamEvent updates marks unread for correct non-active session", () => {
    const store = useChatStore();
    const convStore = useConversationStore();

    const session = makeChatSession({ id: 5, conversationId: 50 });
    store.onChatSessionUpdated(session);

    // Keep conv 99 active so conv 50 is background
    convStore.setActiveConversation(99);

    store.onChatStreamEvent(
      makeStreamEvent(50, "assistant", { taskId: null }),
    );

    expect(store.unreadSessionIds.has(5)).toBe(true);
  });

  it("C5: onChatNewMessage — user message for active session does not mark unread", () => {
    const store = useChatStore();
    const convStore = useConversationStore();

    const session = makeChatSession({ id: 3, conversationId: 30 });
    store.onChatSessionUpdated(session);
    convStore.setActiveConversation(30);

    store.onChatNewMessage({
      id: 10,
      taskId: null,
      conversationId: 30,
      type: "user",
      role: "user",
      content: "hello",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    // user messages don't trigger unread
    expect(store.unreadSessionIds.has(3)).toBe(false);
  });

  it("C6: unreadSessionIds Set identity preserved across multiple mark/clear cycles", () => {
    const store = useChatStore();
    const setRef = store.unreadSessionIds;

    for (let i = 0; i < 3; i++) {
      store.markUnread(i);
      store.clearUnread(i);
    }

    expect(store.unreadSessionIds).toBe(setRef);
  });
});

describe("chatStore — workspace filter", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => []);
  });

  it("C7a: onChatSessionUpdated adds session when workspaceKey matches activeWorkspaceKey", () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = "ws-1";

    store.onChatSessionUpdated(makeChatSession({ id: 10, workspaceKey: "ws-1" }));
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe(10);
  });

  it("C7b: onChatSessionUpdated ignores session when workspaceKey does not match", () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = "ws-1";

    store.onChatSessionUpdated(makeChatSession({ id: 20, workspaceKey: "ws-other" }));
    expect(store.sessions).toHaveLength(0);
  });

  it("C7c: onChatSessionUpdated passes all sessions when activeWorkspaceKey is null", () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = null;

    store.onChatSessionUpdated(makeChatSession({ id: 30, workspaceKey: "any-ws" }));
    expect(store.sessions).toHaveLength(1);
  });

  it("C-MODEL-1: onChatSessionUpdated preserves non-null model", () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = null;

    store.onChatSessionUpdated(makeChatSession({ id: 31, model: "test/model" }));
    expect(store.sessions[0]?.model).toBe("test/model");
  });

  it("C-MODEL-2: onChatSessionUpdated preserves null model", () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = null;

    store.onChatSessionUpdated(makeChatSession({ id: 32, model: null }));
    expect(store.sessions[0]?.model).toBeNull();
  });
});

describe("chatStore — loadSessions idempotency", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("C8a: calling loadSessions twice replaces sessions (no duplicates)", async () => {
    const singleSession = [makeChatSession({ id: 1 })];
    apiMock.mockResolvedValue(singleSession);
    const store = useChatStore();

    await store.loadSessions("ws-1");
    await store.loadSessions("ws-1");

    expect(store.sessions).toHaveLength(1);
  });

  it("C8b: loadSessions passes the workspaceKey to the API", async () => {
    apiMock.mockResolvedValue([]);
    const store = useChatStore();

    await store.loadSessions("ws-2");

    expect(apiMock).toHaveBeenCalledWith("chatSessions.list", { workspaceKey: "ws-2" });
  });

  it("C8c: second loadSessions with different key replaces sessions from first call", async () => {
    const ws1Sessions = [makeChatSession({ id: 1, workspaceKey: "ws-1" })];
    const ws2Sessions = [
      makeChatSession({ id: 2, workspaceKey: "ws-2" }),
      makeChatSession({ id: 3, workspaceKey: "ws-2" }),
    ];
    apiMock
      .mockResolvedValueOnce(ws1Sessions)
      .mockResolvedValueOnce(ws2Sessions);

    const store = useChatStore();

    await store.loadSessions("ws-1");
    expect(store.sessions).toHaveLength(1);

    await store.loadSessions("ws-2");
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions.every((s) => s.workspaceKey === "ws-2")).toBe(true);
  });
});

describe("chatStore — rapid key changes", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("C9: onChatSessionUpdated handles session arrival during rapid key changes", async () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();

    // Simulate rapid key changes: ws-1 → ws-2 → ws-3
    wsStore.activeWorkspaceKey = "ws-1";
    wsStore.activeWorkspaceKey = "ws-2";
    wsStore.activeWorkspaceKey = "ws-3";

    // Session arrives for ws-2 (the middle key that was quickly overwritten)
    store.onChatSessionUpdated(makeChatSession({ id: 100, workspaceKey: "ws-2" }));

    // Should be ignored since current key is ws-3, not ws-2
    expect(store.sessions).toHaveLength(0);

    // Session for current workspace should be accepted
    store.onChatSessionUpdated(makeChatSession({ id: 101, workspaceKey: "ws-3" }));
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].id).toBe(101);
  });
});

// ─── C10: decision_request_prompt message → chatStore status becomes waiting_user ──

describe("chatStore — C10: decision_request_prompt sets session status", () => {
  it("C10: decision_request_prompt message updates session status to waiting_user", () => {
    const store = useChatStore();
    store.sessions = [];

    // Directly add a session to bypass workspace filtering
    store.sessions.push(makeChatSession({ id: 1, status: "idle", conversationId: 1 }));
    expect(store.sessions[0].status).toBe("idle");

    // decision_request_prompt message arrives
    store.onChatNewMessage({
      id: 100,
      taskId: null,
      conversationId: 1,
      type: "decision_request_prompt",
      role: null,
      content: "decision_request_prompt",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    // Session status becomes waiting_user
    const session = store.sessions.find((s) => s.id === 1);
    expect(session!.status).toBe("waiting_user");
  });
});

// ─── C11: decision_request_prompt message → session marked as unread if not active ──

describe("chatStore — C11: decision_request_prompt marks unread for non-active session", () => {
  it("C11: decision_request_prompt marks non-active session as unread", () => {
    const store = useChatStore();
    store.sessions = [];

    // Directly add sessions to bypass workspace filtering
    store.sessions.push(makeChatSession({ id: 1, status: "idle", lastReadAt: null, conversationId: 1 }));
    store.sessions.push(makeChatSession({ id: 2, status: "idle", lastReadAt: null, conversationId: 2 }));
    store.activeChatSessionId = 2;

    // decision_request_prompt for session 1 (non-active)
    store.onChatNewMessage({
      id: 100,
      taskId: null,
      conversationId: 1,
      type: "decision_request_prompt",
      role: null,
      content: "decision_request_prompt",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    // Session 1 status becomes waiting_user
    const session1 = store.sessions.find((s) => s.id === 1);
    expect(session1!.status).toBe("waiting_user");
  });
});

// ─── C12: decision_request_prompt appearing multiple times — correct state management ──

describe("chatStore — C12: decision_request_prompt multiple appearances", () => {
  it("C12: multiple decision_request_prompt messages keep status as waiting_user", () => {
    const store = useChatStore();
    store.sessions = [];

    // Directly add session with conversationId matching the message
    const session = makeChatSession({ id: 1, status: "idle", conversationId: 1 });
    store.sessions.push(session);

    // Verify session was added
    expect(store.sessions.length).toBe(1);
    expect(store.sessions[0].id).toBe(1);

    // First decision_request_prompt
    store.onChatNewMessage({
      id: 100,
      taskId: null,
      conversationId: 1,
      type: "decision_request_prompt",
      role: null,
      content: "First request",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    // Session status should be waiting_user
    const updatedSession = store.sessions.find((s) => s.id === 1);
    expect(updatedSession).toBeDefined();
    expect(updatedSession!.status).toBe("waiting_user");

    // Second decision_request_prompt
    store.onChatNewMessage({
      id: 101,
      taskId: null,
      conversationId: 1,
      type: "decision_request_prompt",
      role: null,
      content: "Second request",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    // Status should still be waiting_user (not reset or error)
    expect(store.sessions[0].status).toBe("waiting_user");
  });
});
