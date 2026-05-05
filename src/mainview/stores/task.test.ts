import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);

vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

vi.mock("./workspace", () => ({
  useWorkspaceStore: () => ({
    availableModels: [],
    allProviderModels: [],
    loadEnabledModels: vi.fn(),
    loadAllModels: vi.fn(),
    setModelEnabled: vi.fn(),
  }),
}));

const { useTaskStore } = await import("./task");
const { useConversationStore } = await import("./conversation");

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    boardId: 1,
    title: "Task",
    description: null,
    workflowState: "backlog",
    position: 0,
    executionState: "idle",
    executionCount: 0,
    projectKey: "test",
    workspaceKey: "default",
    model: null,
    worktreeStatus: "not_created",
    branchName: null,
    worktreePath: null,
    conversationId: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as import("@shared/rpc-types").Task;
}

function makeTransitionMessage() {
  return {
    id: 10,
    taskId: 1,
    conversationId: 1,
    type: "transition_event" as const,
    role: null,
    content: "",
    metadata: { from: "backlog", to: "plan" },
    createdAt: new Date().toISOString(),
  };
}

describe("taskStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => []);
  });

  it("T1: loadTasks populates tasksByBoard and taskIndex", async () => {
    const store = useTaskStore();
    const task = makeTask({ id: 42, boardId: 7 });
    apiMock.mockResolvedValueOnce([task]);

    await store.loadTasks(7);

    expect(store.tasksByBoard[7]).toHaveLength(1);
    expect(store.tasksByBoard[7][0].id).toBe(42);
    expect(store.taskIndex[42]).toBeDefined();
    expect(store.taskIndex[42].id).toBe(42);
  });

  it("T2: loadTasks for two boards — entries are independent", async () => {
    const store = useTaskStore();
    const taskA = makeTask({ id: 1, boardId: 1 });
    const taskB = makeTask({ id: 2, boardId: 2 });
    apiMock.mockResolvedValueOnce([taskA]).mockResolvedValueOnce([taskB]);

    await store.loadTasks(1);
    await store.loadTasks(2);

    expect(store.tasksByBoard[1]).toHaveLength(1);
    expect(store.tasksByBoard[2]).toHaveLength(1);
    expect(store.tasksByBoard[1][0].id).toBe(1);
    expect(store.tasksByBoard[2][0].id).toBe(2);
  });

  it("T3: onTaskUpdated replaces correct task in tasksByBoard via boardId (other board unchanged)", async () => {
    const store = useTaskStore();
    const t1 = makeTask({ id: 1, boardId: 1, title: "Old" });
    const t2 = makeTask({ id: 2, boardId: 2, title: "Board2Task" });
    apiMock.mockResolvedValueOnce([t1]).mockResolvedValueOnce([t2]);
    await store.loadTasks(1);
    await store.loadTasks(2);

    const updated = makeTask({ id: 1, boardId: 1, title: "New" });
    store.onTaskUpdated(updated);

    expect(store.tasksByBoard[1][0].title).toBe("New");
    expect(store.tasksByBoard[2][0].title).toBe("Board2Task"); // unchanged
  });

  it("T4: onTaskUpdated updates taskIndex to new object", async () => {
    const store = useTaskStore();
    const task = makeTask({ id: 5, boardId: 1, title: "Original" });
    apiMock.mockResolvedValueOnce([task]);
    await store.loadTasks(1);

    const updated = makeTask({ id: 5, boardId: 1, title: "Updated" });
    store.onTaskUpdated(updated);

    expect(store.taskIndex[5].title).toBe("Updated");
  });

  // REGRESSION SENTINEL: If _replaceTask did an O(n) linear scan across all boards
  // and the boardId lookup was wrong, this test would fail.
  it("T5: _replaceTask regression — loadTasks then onTaskUpdated updates both tasksByBoard and taskIndex", async () => {
    const store = useTaskStore();
    const task = makeTask({ id: 1, boardId: 1, title: "Before" });
    apiMock.mockResolvedValueOnce([task]);
    await store.loadTasks(1);

    const updated = makeTask({ id: 1, boardId: 1, title: "After" });
    store.onTaskUpdated(updated);

    expect(store.tasksByBoard[1][0].title).toBe("After");
    expect(store.taskIndex[1].title).toBe("After");
  });

  it("T6: markTaskUnread — same Set instance before/after, taskId present", () => {
    const store = useTaskStore();
    const setRef = store.unreadTaskIds;

    store.markTaskUnread(99);

    expect(store.unreadTaskIds).toBe(setRef); // same Set instance
    expect(store.unreadTaskIds.has(99)).toBe(true);
  });

  it("T7: clearTaskUnread — same Set instance before/after, taskId absent", () => {
    const store = useTaskStore();
    store.markTaskUnread(99);
    const setRef = store.unreadTaskIds;

    store.clearTaskUnread(99);

    expect(store.unreadTaskIds).toBe(setRef); // same Set instance
    expect(store.unreadTaskIds.has(99)).toBe(false);
  });

  it("T-A: onTaskStreamEvent file_diff does NOT mark task unread (unread fires only on terminal execution state)", async () => {
    const store = useTaskStore();
    const conversationStore = useConversationStore();
    const task1 = makeTask({ id: 1, boardId: 1, conversationId: 1 });
    const task2 = makeTask({ id: 2, boardId: 1, conversationId: 2 });
    apiMock.mockResolvedValueOnce([task1, task2]);
    await store.loadTasks(1);

    conversationStore.setActiveConversation(1);

    store.onTaskStreamEvent({
      taskId: 2,
      conversationId: 2,
      executionId: 1,
      seq: 0,
      blockId: "b1",
      type: "file_diff",
      content: "",
      metadata: null,
      subagentId: null,
      done: false,
    });

    expect(store.hasUnread(2)).toBe(false);
    expect(store.hasUnread(1)).toBe(false);
  });

  it("T-B: onTaskNewMessage file_diff does NOT mark task unread (unread fires only on terminal execution state)", async () => {
    const store = useTaskStore();
    const conversationStore = useConversationStore();
    const task1 = makeTask({ id: 1, boardId: 1, conversationId: 1 });
    const task2 = makeTask({ id: 2, boardId: 1, conversationId: 2 });
    apiMock.mockResolvedValueOnce([task1, task2]);
    await store.loadTasks(1);

    conversationStore.setActiveConversation(1);

    store.onTaskNewMessage({
      id: 99,
      taskId: 2,
      conversationId: 2,
      type: "file_diff",
      role: null,
      content: "",
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    expect(store.hasUnread(2)).toBe(false);
    expect(store.hasUnread(1)).toBe(false);
  });

  it("T9: deleteTask removes the task from tasksByBoard", async () => {
    const store = useTaskStore();
    const task = makeTask({ id: 7, boardId: 3 });
    apiMock.mockResolvedValueOnce([task]);
    await store.loadTasks(3);
    expect(store.tasksByBoard[3]).toHaveLength(1);

    apiMock.mockImplementation(async () => ({}));
    await store.deleteTask(7);

    expect(store.tasksByBoard[3]).toHaveLength(0);
    expect(store.taskIndex[7]).toBeUndefined();
  });

  it("reloads active task messages after a transition so new transition cards appear immediately", async () => {
    const task = makeTask();
    const updatedTask = makeTask({ workflowState: "plan", executionState: "running" });
    const transitionMessage = makeTransitionMessage();

    apiMock.mockImplementation(async (method, params) => {
      if (method === "tasks.list") return [task];
      if (method === "conversations.getMessages") {
        const query = params as { conversationId: number };
        expect(query.conversationId).toBe(1);
        const transitionAlreadyLoaded = apiMock.mock.calls.some(
          ([calledMethod]) => calledMethod === "tasks.transition",
        );
        return {
          messages: transitionAlreadyLoaded ? [transitionMessage] : [],
          hasMore: false,
        };
      }
      if (method === "tasks.transition") {
        return { task: updatedTask, executionId: 99 };
      }
      if (method === "conversations.contextUsage") {
        return { usedTokens: 0, maxTokens: 8192, fraction: 0 };
      }
      if (method === "tasks.getChangedFiles") return [];
      if (method === "tasks.getGitStat") return null;
      return [];
    });

    const taskStore = useTaskStore();
    const conversationStore = useConversationStore();

    await taskStore.loadTasks(1);
    await taskStore.selectTask(1);
    expect(conversationStore.messages).toEqual([]);

    await taskStore.transitionTask(1, "plan");

    expect(conversationStore.messages).toEqual([transitionMessage]);
    expect(taskStore.activeTask?.workflowState).toBe("plan");
    expect(apiMock.mock.calls.filter(([method]) => method === "conversations.getMessages")).toHaveLength(2);
  });

  // ─── Unread dot: terminal execution states ──────────────────────────────────

  it("T10: onTaskUpdated marks unread when execution reaches 'completed' (background task)", async () => {
    const store = useTaskStore();
    const running = makeTask({ id: 10, boardId: 1, executionState: "running" });
    const completed = makeTask({ id: 10, boardId: 1, executionState: "completed" });
    apiMock.mockResolvedValueOnce([running]);
    await store.loadTasks(1);

    store.onTaskUpdated(completed);

    expect(store.unreadTaskIds.has(10)).toBe(true);
  });

  it("T11: onTaskUpdated marks unread when execution reaches 'waiting_user'", async () => {
    const store = useTaskStore();
    const running = makeTask({ id: 11, boardId: 1, executionState: "running" });
    const waiting = makeTask({ id: 11, boardId: 1, executionState: "waiting_user" });
    apiMock.mockResolvedValueOnce([running]);
    await store.loadTasks(1);

    store.onTaskUpdated(waiting);

    expect(store.unreadTaskIds.has(11)).toBe(true);
  });

  it("T12: onTaskUpdated marks unread when execution reaches 'failed'", async () => {
    const store = useTaskStore();
    const running = makeTask({ id: 12, boardId: 1, executionState: "running" });
    const failed = makeTask({ id: 12, boardId: 1, executionState: "failed" });
    apiMock.mockResolvedValueOnce([running]);
    await store.loadTasks(1);

    store.onTaskUpdated(failed);

    expect(store.unreadTaskIds.has(12)).toBe(true);
  });

  it("T13: onTaskUpdated does NOT mark unread while task is still 'running'", async () => {
    const store = useTaskStore();
    const idle = makeTask({ id: 13, boardId: 1, executionState: "idle" });
    const running = makeTask({ id: 13, boardId: 1, executionState: "running" });
    apiMock.mockResolvedValueOnce([idle]);
    await store.loadTasks(1);

    store.onTaskUpdated(running);

    expect(store.unreadTaskIds.has(13)).toBe(false);
  });

  it("T14: onTaskUpdated does NOT mark unread for active (selected) task even on terminal state", async () => {
    const store = useTaskStore();
    const running = makeTask({ id: 14, boardId: 1, executionState: "running" });
    const completed = makeTask({ id: 14, boardId: 1, executionState: "completed" });
    apiMock.mockImplementation((async (method: string) => {
      if (method === "tasks.list") return [running];
      if (method === "conversations.getMessages") return { messages: [], hasMore: false };
      if (method === "conversations.contextUsage") return { usedTokens: 0, maxTokens: 8192, fraction: 0 };
      if (method === "tasks.getChangedFiles") return [];
      if (method === "tasks.getGitStat") return null;
      return [];
    }) as any);
    await store.loadTasks(1);
    await store.selectTask(14); // make it the active task

    store.onTaskUpdated(completed);

    // Active task should NOT get the unread dot
    expect(store.unreadTaskIds.has(14)).toBe(false);
  });

  it("T15: onTaskStreamEvent does NOT mark unread on 'done' stream event", async () => {
    const store = useTaskStore();
    const running = makeTask({ id: 15, boardId: 1, executionState: "running" });
    apiMock.mockResolvedValueOnce([running]);
    await store.loadTasks(1);

    store.onTaskStreamEvent({ type: "done", taskId: 15, executionId: 42 } as Parameters<typeof store.onTaskStreamEvent>[0]);

    expect(store.unreadTaskIds.has(15)).toBe(false);
  });

  it("T16: onTaskNewMessage does NOT mark unread when message arrives during streaming", async () => {
    const store = useTaskStore();
    const running = makeTask({ id: 16, boardId: 1, executionState: "running" });
    apiMock.mockResolvedValueOnce([running]);
    await store.loadTasks(1);

    store.onTaskNewMessage({ taskId: 16, type: "assistant", content: "thinking..." } as Parameters<typeof store.onTaskNewMessage>[0]);

    expect(store.unreadTaskIds.has(16)).toBe(false);
  });
});
