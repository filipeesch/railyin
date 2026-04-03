import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { electroview } from "../rpc";
import type { Task, ConversationMessage, StreamToken, StreamError } from "@shared/rpc-types";

export const useTaskStore = defineStore("task", () => {
  // All tasks keyed by boardId
  const tasksByBoard = ref<Record<number, Task[]>>({});

  // Active task detail
  const activeTaskId = ref<number | null>(null);
  const messages = ref<ConversationMessage[]>([]);
  const streamingToken = ref("");     // accumulates current stream
  const streamingTaskId = ref<number | null>(null);   // which task is streaming
  const streamingExecutionId = ref<number | null>(null);

  const loading = ref(false);
  const messagesLoading = ref(false);

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
    _replaceTask(task);
    return task;
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  async function retryTask(taskId: number) {
    const { task } = await electroview.rpc.request["tasks.retry"]({ taskId });
    _replaceTask(task);
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
    streamingExecutionId.value = executionId;
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
      streamingExecutionId.value = null;
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
    await loadMessages(taskId);
  }

  function closeTask() {
    activeTaskId.value = null;
    messages.value = [];
    // Keep streamingToken/streamingTaskId/streamingExecutionId alive so tokens
    // that arrive while the drawer is closed are not dropped. They will be
    // restored when the user re-opens the same task.
  }

  // ─── IPC push handlers ────────────────────────────────────────────────────

  function onStreamToken(payload: StreamToken) {
    // Always accumulate tokens regardless of which task is open in the drawer.
    // We track the streaming task separately from the active (visible) task.
    if (payload.taskId !== streamingTaskId.value) return;
    if (payload.done) {
      // Always flush the accumulated token, even if the drawer was closed.
      // The drawer re-opening will call loadMessages() which replaces messages from DB.
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
      streamingExecutionId.value = null;
      streamingTaskId.value = null;
    } else {
      streamingToken.value += payload.token;
    }
  }

  function onStreamError(payload: StreamError) {
    if (payload.taskId !== streamingTaskId.value) return;
    streamingToken.value = "";
    streamingExecutionId.value = null;
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
    streamingTaskId,
    streamingExecutionId,
    loading,
    messagesLoading,
    loadTasks,
    createTask,
    transitionTask,
    retryTask,
    sendMessage,
    loadMessages,
    selectTask,
    closeTask,
    onStreamToken,
    onStreamError,
    onTaskUpdated,
  };
});
