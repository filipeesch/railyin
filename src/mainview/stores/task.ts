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
  const streamingToken = ref("");  // accumulates current stream
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
    streamingExecutionId.value = executionId;
    streamingToken.value = "";
  }

  // ─── Load messages for active task ────────────────────────────────────────

  async function loadMessages(taskId: number) {
    messagesLoading.value = true;
    activeTaskId.value = taskId;
    streamingToken.value = "";
    streamingExecutionId.value = null;
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
    streamingToken.value = "";
    streamingExecutionId.value = null;
  }

  // ─── IPC push handlers ────────────────────────────────────────────────────

  function onStreamToken(payload: StreamToken) {
    if (payload.taskId !== activeTaskId.value) return;
    if (payload.done) {
      // Flush accumulated stream as a new assistant message
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
        streamingToken.value = "";
      }
      streamingExecutionId.value = null;
    } else {
      streamingToken.value += payload.token;
    }
  }

  function onStreamError(payload: StreamError) {
    if (payload.taskId !== activeTaskId.value) return;
    streamingToken.value = "";
    streamingExecutionId.value = null;
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
