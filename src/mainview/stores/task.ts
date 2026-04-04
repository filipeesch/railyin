import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { electroview } from "../rpc";
import type { Task, ConversationMessage, StreamToken, StreamError, ModelInfo } from "@shared/rpc-types";

export const useTaskStore = defineStore("task", () => {
  // All tasks keyed by boardId
  const tasksByBoard = ref<Record<number, Task[]>>({});

  // Active task detail
  const activeTaskId = ref<number | null>(null);
  const messages = ref<ConversationMessage[]>([]);
  const streamingToken = ref("");     // accumulates current stream
  const streamingTaskId = ref<number | null>(null);   // which task is streaming

  // Reasoning display (task 4.1-4.3)
  const streamingReasoningToken = ref("");   // live reasoning text for active round
  const isStreamingReasoning = ref(false);   // true while reasoning tokens are arriving

  const loading = ref(false);
  const messagesLoading = ref(false);

  // Available AI models fetched from the provider endpoint
  const availableModels = ref<ModelInfo[]>([]);

  // Context usage for the active task (stale-on-load, updated after executions)
  const contextUsage = ref<{ usedTokens: number; maxTokens: number; fraction: number } | null>(null);

  const activeTask = computed(() => {
    for (const tasks of Object.values(tasksByBoard.value)) {
      const found = tasks.find((t) => t.id === activeTaskId.value);
      if (found) return found;
    }
    return null;
  });

  // ─── Load tasks for a board ───────────────────────────────────────────────

  async function loadTasks(boardId: number) {
    loading.value = true;
    try {
      tasksByBoard.value[boardId] = await electroview.rpc.request["tasks.list"]({ boardId });
    } finally {
      loading.value = false;
    }
  }

  // ─── Create task ──────────────────────────────────────────────────────────

  async function createTask(params: {
    boardId: number;
    projectId: number;
    title: string;
    description: string;
  }) {
    const task = await electroview.rpc.request["tasks.create"](params);
    if (!tasksByBoard.value[params.boardId]) tasksByBoard.value[params.boardId] = [];
    tasksByBoard.value[params.boardId].push(task);
    return task;
  }

  // ─── Transition task ──────────────────────────────────────────────────────

  async function transitionTask(taskId: number, toState: string) {
    const { task } = await electroview.rpc.request["tasks.transition"]({ taskId, toState });
    onTaskUpdated(task);
    return task;
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  async function retryTask(taskId: number) {
    const { task } = await electroview.rpc.request["tasks.retry"]({ taskId });
    onTaskUpdated(task);
    return task;
  }

  // ─── Send message ─────────────────────────────────────────────────────────

  async function sendMessage(taskId: number, content: string) {
    const { message, executionId } = await electroview.rpc.request["tasks.sendMessage"]({
      taskId,
      content,
    });
    messages.value.push(message);
    streamingTaskId.value = taskId;
    streamingToken.value = "";
  }

  // ─── Load messages for active task ────────────────────────────────────────

  async function loadMessages(taskId: number) {
    messagesLoading.value = true;
    activeTaskId.value = taskId;
    // Only reset streaming state if this task is NOT currently streaming.
    // If it is streaming, we keep the accumulated token so the bubble stays visible.
    if (streamingTaskId.value !== taskId) {
      streamingToken.value = "";
    }
    try {
      messages.value = await electroview.rpc.request["conversations.getMessages"]({ taskId });
    } finally {
      messagesLoading.value = false;
    }
  }

  // ─── Select task (opens detail) ───────────────────────────────────────────

  async function selectTask(taskId: number) {
    activeTaskId.value = taskId;
    contextUsage.value = null;
    await loadMessages(taskId);
    fetchContextUsage(taskId);
  }

  function closeTask() {
    activeTaskId.value = null;
    messages.value = [];
    // Keep streamingToken/streamingTaskId alive so tokens
    // that arrive while the drawer is closed are not dropped. They will be
    // restored when the user re-opens the same task.
  }

  // ─── IPC push handlers ────────────────────────────────────────────────────

  function onStreamToken(payload: StreamToken) {
    // Always accumulate tokens regardless of which task is open in the drawer.
    // We track the streaming task separately from the active (visible) task.
    if (payload.taskId !== streamingTaskId.value) return;
    if (payload.done) {
      // Flush the streaming bubble to the messages list immediately so there's
      // no visible gap while loadMessages fetches from DB.
      if (streamingToken.value) {
        messages.value.push({
          id: Date.now(),
          taskId: payload.taskId,
          conversationId: 0,
          type: "assistant",
          role: "assistant",
          content: streamingToken.value,
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
      streamingToken.value = "";
      streamingReasoningToken.value = "";
      isStreamingReasoning.value = false;
      streamingTaskId.value = null;
      // Sync with DB so the real persisted message (with correct id/metadata) replaces
      // the optimistic in-memory copy above. Fire-and-forget; task must be active.
      if (activeTaskId.value === payload.taskId) {
        loadMessages(payload.taskId);
      }
    } else if (payload.isReasoning) {
      // Reasoning token: if this is the start of a new round (prev round collapsed),
      // clear old content so we start a fresh live bubble.
      if (!isStreamingReasoning.value) {
        streamingReasoningToken.value = "";
      }
      streamingReasoningToken.value += payload.token;
      isStreamingReasoning.value = true;
    } else {
      // Regular text token: if reasoning was active, mark it as done (auto-collapse)
      if (isStreamingReasoning.value) {
        isStreamingReasoning.value = false;
      }
      streamingToken.value += payload.token;
    }
  }

  function onStreamError(payload: StreamError) {
    if (payload.taskId !== streamingTaskId.value) return;
    streamingToken.value = "";
    streamingTaskId.value = null;
    if (payload.taskId !== activeTaskId.value) return;
    messages.value.push({
      id: Date.now(),
      taskId: payload.taskId,
      conversationId: 0,
      type: "system",
      role: null,
      content: `Error: ${payload.error}`,
      metadata: null,
      createdAt: new Date().toISOString(),
    });
  }

  function onTaskUpdated(task: Task) {
    _replaceTask(task);
    // Prime streaming state as soon as execution starts. The engine always sends
    // task.updated → running before emitting any stream.token, so setting
    // streamingTaskId here guarantees tokens are never dropped by the early-return
    // guard in onStreamToken. This also covers auto-executions triggered by
    // handleTransition (on_enter_prompt), which never go through sendMessage.
    if (task.executionState === "running" && streamingTaskId.value === null) {
      streamingTaskId.value = task.id;
      streamingToken.value = "";
      streamingReasoningToken.value = "";
      isStreamingReasoning.value = false;
    }
    // Refresh context usage when the active task finishes an execution
    if (
      task.id === activeTaskId.value &&
      task.executionState !== "running"
    ) {
      fetchContextUsage(task.id);
    }
  }

  function onNewMessage(message: ConversationMessage) {
    // Only append if this task is currently open in the drawer
    if (message.taskId !== activeTaskId.value) return;
    // Avoid duplicates — loadMessages after stream done may re-add the same messages
    if (messages.value.some((m) => m.id === message.id)) return;
    // When a reasoning round is persisted to DB, the live streaming bubble has served
    // its purpose — clear it so the collapsed DB card takes its place and the next
    // round's reasoning starts fresh.
    if (message.type === "reasoning") {
      streamingReasoningToken.value = "";
      isStreamingReasoning.value = false;
    }
    messages.value.push(message);
  }

  // ─── Load available models ────────────────────────────────────────────────

  async function loadModels() {
    availableModels.value = await electroview.rpc.request["models.list"]({});
  }

  // ─── Fetch context usage for active task ──────────────────────────────────

  async function fetchContextUsage(taskId: number) {
    try {
      contextUsage.value = await electroview.rpc.request["tasks.contextUsage"]({ taskId });
    } catch {
      contextUsage.value = null;
    }
  }

  // ─── Set model on task ────────────────────────────────────────────────────

  async function setModel(taskId: number, model: string | null) {
    const task = await electroview.rpc.request["tasks.setModel"]({ taskId, model });
    _replaceTask(task);
    return task;
  }

  // ─── Cancel running execution ─────────────────────────────────────────────

  async function cancelTask(taskId: number) {
    const task = await electroview.rpc.request["tasks.cancel"]({ taskId });
    _replaceTask(task);
    return task;
  }

  // ─── Update task title/description ───────────────────────────────────────

  async function updateTask(taskId: number, title: string, description: string) {
    const task = await electroview.rpc.request["tasks.update"]({ taskId, title, description });
    _replaceTask(task);
    return task;
  }

  // ─── Delete task ──────────────────────────────────────────────────────────

  async function deleteTask(taskId: number): Promise<{ warning?: string }> {
    const result = await electroview.rpc.request["tasks.delete"]({ taskId });
    for (const [boardId, tasks] of Object.entries(tasksByBoard.value)) {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        tasksByBoard.value[Number(boardId)].splice(idx, 1);
        break;
      }
    }
    if (activeTaskId.value === taskId) {
      activeTaskId.value = null;
      messages.value = [];
    }
    return { warning: result.warning };
  }

  // ─── Compact conversation ─────────────────────────────────────────────────

  async function compactTask(taskId: number) {
    await electroview.rpc.request["tasks.compact"]({ taskId });
    await loadMessages(taskId);
    await fetchContextUsage(taskId);
  }

  async function getGitStat(taskId: number): Promise<string | null> {
    return electroview.rpc.request["tasks.getGitStat"]({ taskId });
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  function _replaceTask(updated: Task) {
    for (const [boardId, tasks] of Object.entries(tasksByBoard.value)) {
      const idx = tasks.findIndex((t) => t.id === updated.id);
      if (idx !== -1) {
        tasksByBoard.value[Number(boardId)][idx] = updated;
        break;
      }
    }
  }

  return {
    tasksByBoard,
    activeTaskId,
    activeTask,
    messages,
    streamingToken,
    streamingReasoningToken,
    isStreamingReasoning,
    streamingTaskId,
    loading,
    messagesLoading,
    availableModels,
    contextUsage,
    loadTasks,
    createTask,
    transitionTask,
    retryTask,
    sendMessage,
    loadMessages,
    selectTask,
    closeTask,
    loadModels,
    fetchContextUsage,
    compactTask,
    setModel,
    cancelTask,
    updateTask,
    deleteTask,
    getGitStat,
    onStreamToken,
    onStreamError,
    onTaskUpdated,
    onNewMessage,
  };
});
