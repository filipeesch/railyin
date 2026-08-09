/**
 * dispatch.test.ts — Multi-store dispatch tests for the kept /ws pushes
 *
 * Verifies the App.vue wiring of the kept push types (task.updated,
 * chatSession.updated) delivers to the right store handlers. The stream-event
 * and message.new dispatch coverage died with the protocol trim (07-03).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
vi.mock("../rpc", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
}));

const { useConversationStore } = await import("./conversation");
const { useTaskStore } = await import("./task");
const { useChatStore } = await import("./chat");

function makeTask(boardId = 1, id = 1): import("@shared/rpc-types").Task {
  return {
    id,
    boardId,
    title: "Task",
    description: "",
    workflowState: "backlog",
    position: 0,
    executionState: "idle",
    executionCount: 0,
    projectKey: "test",
    model: null,
    worktreeStatus: "not_created",
    branchName: null,
    worktreePath: null,
    conversationId: 1,
    currentExecutionId: null,
    retryCount: 0,
    createdFromTaskId: null,
    createdFromExecutionId: null,
    shellAutoApprove: false,
    approvedCommands: [],
    enabledMcpTools: null,
  } as unknown as import("@shared/rpc-types").Task;
}

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

describe("kept-push dispatch", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => ({ messages: [], hasMore: false }));
  });

  it("D1: task.updated push dispatches to the task store (onTaskUpdated)", async () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();
    void conv; void chat;

    const original = makeTask(1, 1);
    apiMock.mockResolvedValueOnce([original]);
    await task.loadTasks(1);

    const updated = makeTask(1, 1);
    updated.title = "Renamed via push";
    task.onTaskUpdated(updated);

    expect(task.taskIndex[1].title).toBe("Renamed via push");
    expect(task.tasksByBoard[1][0].title).toBe("Renamed via push");
  });

  it("D2: chatSession.updated push dispatches to the chat store (onChatSessionUpdated)", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();
    void conv; void task;

    chat.onChatSessionUpdated(makeChatSession({ id: 7, conversationId: 70, status: "running" }));
    expect(chat.sessions).toHaveLength(1);

    // Running → idle push flips the status the drawer reads
    chat.onChatSessionUpdated(makeChatSession({ id: 7, conversationId: 70, status: "idle" }));
    expect(chat.sessions[0].status).toBe("idle");
  });

  it("D3: dispatch with unknown payload shapes does not throw in any store", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();
    void conv;

    // chatSession.updated for a session in another workspace is filtered, not thrown
    expect(() =>
      chat.onChatSessionUpdated(makeChatSession({ id: 999, workspaceKey: "other" })),
    ).not.toThrow();

    // task.updated for an unknown task is replaced into the index without throwing
    expect(() => task.onTaskUpdated(makeTask(9, 999))).not.toThrow();
  });
});
