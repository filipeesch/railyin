import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

// Shared-singleton workspace mock (module-level so the chat store and the tests
// observe the SAME activeWorkspaceKey). Without it, task.test.ts's ./workspace
// mock (which lacks activeWorkspaceKey) leaks into this file when both run in
// one process, silently filtering every session out.
const workspaceState = {
  activeWorkspaceKey: null as string | null,
  availableModels: [] as unknown[],
  allProviderModels: [] as unknown[],
  loadEnabledModels: vi.fn(),
  loadAllModels: vi.fn(),
  setModelEnabled: vi.fn(),
};
vi.mock("./workspace", () => ({
  useWorkspaceStore: () => workspaceState,
}));

const { useChatStore } = await import("./chat");
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

  it("C13: onChatSessionUpdated marks unread for non-active session when status is idle/waiting_user", () => {
    // Replacement for the removed onChatNewMessage unread path: the
    // chatSession.updated push now carries the terminal/waiting status.
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = null;

    store.onChatSessionUpdated(makeChatSession({ id: 1, conversationId: 10, status: "running", lastReadAt: null }));
    expect(store.unreadSessionIds.has(1)).toBe(false);

    // Running → idle push for a non-active session with no lastReadAt → unread
    store.onChatSessionUpdated(makeChatSession({ id: 1, conversationId: 10, status: "idle", lastReadAt: null }));
    expect(store.unreadSessionIds.has(1)).toBe(true);
  });

  it("C14: onChatSessionUpdated does not mark unread for the active session", () => {
    const store = useChatStore();
    const wsStore = useWorkspaceStore();
    wsStore.activeWorkspaceKey = null;

    store.onChatSessionUpdated(makeChatSession({ id: 5, conversationId: 50, status: "running", lastReadAt: null }));
    store.activeChatSessionId = 5;

    store.onChatSessionUpdated(makeChatSession({ id: 5, conversationId: 50, status: "idle", lastReadAt: null }));
    expect(store.unreadSessionIds.has(5)).toBe(false);
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

// ─── C-14/C-15: submitDecisions recordAsDecisions threading ───────────────────

describe("chatStore — submitDecisions recordAsDecisions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("C-14: submitDecisions passes recordAsDecisions=false to API", async () => {
    const store = useChatStore();
    store.sessions.push(makeChatSession({ id: 1, conversationId: 10 }));
    store.activeChatSessionId = 1;

    await store.submitDecisions(1, [], undefined, false);

    const submitCalls = apiMock.mock.calls.filter((c) => c[0] === "chatSessions.submitDecisions");
    const call = submitCalls[submitCalls.length - 1];
    expect(call).toBeDefined();
    expect(call[1]).toEqual(expect.objectContaining({ sessionId: 1, recordAsDecisions: false }));
  });

  it("C-15: submitDecisions defaults recordAsDecisions to true", async () => {
    const store = useChatStore();
    store.sessions.push(makeChatSession({ id: 1, conversationId: 10 }));
    store.activeChatSessionId = 1;

    await store.submitDecisions(1, []);

    const submitCalls = apiMock.mock.calls.filter((c) => c[0] === "chatSessions.submitDecisions");
    const call = submitCalls[submitCalls.length - 1];
    expect(call).toBeDefined();
    expect(call[1]).toEqual(expect.objectContaining({ sessionId: 1, recordAsDecisions: true }));
  });
});
