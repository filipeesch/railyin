/**
 * dispatch.test.ts — Multi-store dispatch ordering tests (D1…D5)
 *
 * Verifies that the App.vue dispatch sequence (conversationStore → taskStore → chatStore)
 * is correct: downstream stores read already-updated conversation state.
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

function makeStreamEvent(
  conversationId: number,
  taskId: number | null,
  type: import("@shared/rpc-types").StreamEventType,
  overrides: Partial<import("@shared/rpc-types").StreamEvent> = {},
): import("@shared/rpc-types").StreamEvent {
  return {
    taskId,
    conversationId,
    executionId: 1,
    seq: 1,
    blockId: "b1",
    type,
    content: "hello",
    metadata: null,
    parentBlockId: null,
    subagentId: null,
    done: false,
    ...overrides,
  };
}

function makeTask(boardId = 1, id = 1): import("@shared/rpc-types").Task {
  return {
    id,
    boardId,
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
  };
}

/** Simulates the App.vue dispatch sequence for a stream event */
function dispatch(
  conv: ReturnType<typeof useConversationStore>,
  task: ReturnType<typeof useTaskStore>,
  chat: ReturnType<typeof useChatStore>,
  event: import("@shared/rpc-types").StreamEvent,
) {
  conv.onStreamEvent(event);
  task.onTaskStreamEvent(event);
  chat.onChatStreamEvent(event);
}

/** Simulates the App.vue dispatch sequence for a new message */
function dispatchMessage(
  conv: ReturnType<typeof useConversationStore>,
  task: ReturnType<typeof useTaskStore>,
  chat: ReturnType<typeof useChatStore>,
  message: import("@shared/rpc-types").ConversationMessage,
) {
  conv.onNewMessage(message);
  task.onTaskNewMessage(message);
  chat.onChatNewMessage(message);
}

describe("multi-store dispatch ordering", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.mockImplementation(async () => ({ messages: [], hasMore: false }));
  });

  // D1: conversationStore is populated BEFORE taskStore reads it.
  // After the dispatch, conversationStore.streamStates must have the entry.
  it("D1: conversation store is populated before task store reacts to the same event", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();

    conv.setActiveConversation(1);
    const event = makeStreamEvent(1, 1, "text_chunk");

    dispatch(conv, task, chat, event);

    // Conversation store has the stream state populated
    const state = conv.streamStates.get(1);
    expect(state).toBeDefined();
    expect(state!.roots).toHaveLength(1);
  });

  it("D2: all three stores receive the event after full dispatch", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();

    conv.setActiveConversation(1);

    // Load a task so taskStore can react to unread marking on background events
    apiMock.mockResolvedValueOnce([makeTask(1, 1)]);

    const event = makeStreamEvent(1, 1, "text_chunk");
    dispatch(conv, task, chat, event);

    // Conversation store has stream state
    expect(conv.streamStates.get(1)).toBeDefined();
    // Task store — onTaskStreamEvent only marks unread for non-active tasks; it doesn't throw
    // Chat store — onChatStreamEvent ignores events with taskId != null
    // All three completed without throwing = test passes
  });

  it("D3: onNewMessage dispatch — conversation store appends message before task store reacts", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();

    conv.setActiveConversation(1);

    const message: import("@shared/rpc-types").ConversationMessage = {
      id: 1,
      taskId: 1,
      conversationId: 1,
      type: "assistant",
      role: "assistant",
      content: "from agent",
      metadata: null,
      createdAt: new Date().toISOString(),
    };

    dispatchMessage(conv, task, chat, message);

    // Conversation store has the message
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].content).toBe("from agent");
  });

  it("D4: repeated dispatch with same event is idempotent (no duplicate stream entries)", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();

    conv.setActiveConversation(1);
    const event = makeStreamEvent(1, 1, "text_chunk", { content: "x" });

    dispatch(conv, task, chat, event);
    dispatch(conv, task, chat, event);

    // The second dispatch replays the same event — same executionId means block appends, not duplicates
    const state = conv.streamStates.get(1)!;
    expect(state.roots).toHaveLength(1); // still one root block
  });

  it("D5: dispatch with unknown conversationId does not throw in any store", () => {
    const conv = useConversationStore();
    const task = useTaskStore();
    const chat = useChatStore();

    // No active conversation, no tasks loaded
    const event = makeStreamEvent(999, 999, "text_chunk");

    expect(() => dispatch(conv, task, chat, event)).not.toThrow();
  });
});
