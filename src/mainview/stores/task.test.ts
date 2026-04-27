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
    projectKey: "test-project",
    title: "Task 1",
    description: "",
    workflowState: "backlog",
    executionState: "idle",
    conversationId: 1,
    currentExecutionId: null,
    retryCount: 0,
    createdFromTaskId: null,
    createdFromExecutionId: null,
    model: "copilot/gpt-4.1",
    enabledMcpTools: null,
    shellAutoApprove: false,
    approvedCommands: [],
    worktreeStatus: null,
    branchName: null,
    worktreePath: null,
    executionCount: 0,
    position: 0,
    ...overrides,
  };
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
    apiMock.mockReset();
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
});
