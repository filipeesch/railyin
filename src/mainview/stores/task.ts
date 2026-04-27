import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../rpc";
import { useDrawerStore } from "./drawer";
import type { Task, ConversationMessage, StreamError, StreamEvent, GitNumstat } from "@shared/rpc-types";
import { classifyTaskActivity, workspaceHasUnreadTasks, type TaskActivityEvent } from "../workspace-helpers";
import { useConversationStore } from "./conversation";
import { useWorkspaceStore } from "./workspace";
import { type QueuedMessage, type QueueState, emptyQueueState } from "./queue-types";

export const useTaskStore = defineStore("task", () => {
  const conversationStore = useConversationStore();
  const workspaceStore = useWorkspaceStore();

  // All tasks keyed by boardId
  const tasksByBoard = ref<Record<number, Task[]>>({});
  const taskIndex = ref<Record<number, Task>>({});
  const unreadTaskIds = ref(new Set<number>());

  // Active task detail
  const activeTaskId = ref<number | null>(null);
  const messages = computed(() => conversationStore.messages);
  const hasMoreBefore = computed(() => conversationStore.hasMoreBefore);
  const isLoadingOlder = computed(() => conversationStore.isLoadingOlder);

  const streamStates = computed(() => conversationStore.streamStates);
  const streamVersion = computed(() => conversationStore.streamVersion);

  const loading = ref(false);
  const messagesLoading = computed(() => conversationStore.messagesLoading);

  const availableModels = computed(() => workspaceStore.availableModels);
  const allProviderModels = computed(() => workspaceStore.allProviderModels);
  const contextUsage = computed(() => conversationStore.contextUsage);

  // Changed file counts per task (populated from file_diff events and task completion)
  const changedFileCounts = ref<Record<number, number>>({});

  // ─── Queue state ──────────────────────────────────────────────────────────
  const taskQueues = ref<Record<number, QueueState>>({});

  const activeTask = computed(() => {
    return activeTaskId.value != null ? taskIndex.value[activeTaskId.value] ?? null : null;
  });

  const activeStreamState = computed(() => conversationStore.activeStreamState);

  function markTaskUnread(taskId: number) {
    unreadTaskIds.value = new Set([...unreadTaskIds.value, taskId]);
  }

  function clearTaskUnread(taskId: number) {
    const next = new Set(unreadTaskIds.value);
    next.delete(taskId);
    unreadTaskIds.value = next;
  }

  // ─── Load tasks for a board ───────────────────────────────────────────────

  async function loadTasks(boardId: number) {
    loading.value = true;
    try {
      const tasks = await api("tasks.list", { boardId });
      tasksByBoard.value[boardId] = tasks;
      for (const task of tasks) {
        taskIndex.value[task.id] = task;
      }
    } finally {
      loading.value = false;
    }
  }

  // ─── Create task ──────────────────────────────────────────────────────────

  async function createTask(params: {
    boardId: number;
    projectKey: string;
    title: string;
    description: string;
  }) {
    const task = await api("tasks.create", params);
    if (!tasksByBoard.value[params.boardId]) tasksByBoard.value[params.boardId] = [];
    tasksByBoard.value[params.boardId].push(task);
    taskIndex.value[task.id] = task;
    return task;
  }

  // ─── Reorder task (same-column position change — no AI turn) ─────────────

  async function reorderTask(taskId: number, position: number) {
    const prior = Object.values(tasksByBoard.value).flat().find((t) => t.id === taskId);
    if (prior) _replaceTask({ ...prior, position });
    try {
      const task = await api("tasks.reorder", { taskId, position });
      _replaceTask(task);
      return task;
    } catch (err) {
      if (prior) _replaceTask(prior);
      throw err;
    }
  }

  // ─── Batch reorder all tasks in a column (optimistic, fire-and-forget) ────

  function reorderColumnBatch(boardId: number, columnId: string, taskIds: number[]) {
    const tasks = tasksByBoard.value[boardId];
    if (!tasks) return;
    // Assign new positions immediately so Vue re-sorts the column correctly
    const posMap = new Map(taskIds.map((id, i) => [id, (i + 1) * 1000]));
    tasksByBoard.value[boardId] = tasks.map((t) =>
      posMap.has(t.id) ? { ...t, position: posMap.get(t.id)! } : t,
    );
    // Sync to backend fire-and-forget — failure only logs, no rollback needed
    api("tasks.reorderColumn", { boardId, columnId, taskIds }).catch(console.error);
  }

  // ─── Transition task ──────────────────────────────────────────────────────

  async function transitionTask(taskId: number, toState: string, targetPosition?: number) {
    // Optimistic update: move the card immediately so there's no visible snap-back
    // while awaiting the RPC round-trip.
    const prior = Object.values(tasksByBoard.value).flat().find((t) => t.id === taskId);
    if (prior) {
      _replaceTask({
        ...prior,
        workflowState: toState,
        ...(targetPosition != null ? { position: targetPosition } : {}),
      });
    }

    try {
      const { task } = await api("tasks.transition", {
        taskId,
        toState,
        ...(targetPosition != null ? { targetPosition } : {}),
      });
      onTaskUpdated(task); // sync final state (executionState, model override, etc.)
      return task;
    } catch (err) {
      // Revert optimistic move on error so the card ends up in a consistent state
      if (prior) _replaceTask(prior);
      throw err;
    }
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  async function retryTask(taskId: number) {
    const { task } = await api("tasks.retry", { taskId });
    onTaskUpdated(task);
    return task;
  }

  // ─── Send message ─────────────────────────────────────────────────────────

  async function sendMessage(taskId: number, content: string, engineContent?: string, attachments?: import("@shared/rpc-types").Attachment[]) {
    const { message, executionId } = await api("tasks.sendMessage", {
      taskId,
      content,
      ...(engineContent != null ? { engineContent } : {}),
      ...(attachments?.length ? { attachments } : {}),
    });
    void executionId;
    conversationStore.appendMessage(message);
  }

  // ─── Load messages for active task ────────────────────────────────────────

  async function loadMessages(taskId: number) {
    const task = taskIndex.value[taskId];
    if (!task) return;
    activeTaskId.value = taskId;
    await conversationStore.loadMessages({ conversationId: task.conversationId });
  }

  async function loadOlderMessages(taskId: number) {
    const task = taskIndex.value[taskId];
    if (!task) return;
    await conversationStore.loadOlderMessages({ conversationId: task.conversationId });
  }

  // ─── Select task (opens detail) ───────────────────────────────────────────

  async function selectTask(taskId: number) {
    activeTaskId.value = taskId;
    clearTaskUnread(taskId);
    const task = taskIndex.value[taskId];
    if (task) conversationStore.setActiveConversation(task.conversationId);
    await loadMessages(taskId);
    fetchContextUsage(taskId);
  }

  function closeTask() {
    const drawerStore = useDrawerStore();
    activeTaskId.value = null;
    conversationStore.setActiveConversation(null);
    if (drawerStore.mode === "task") drawerStore.close();
  }

  // ─── IPC push handlers ────────────────────────────────────────────────────

  function onStreamEvent(event: StreamEvent) {
    conversationStore.onStreamEvent(event);
  }

  function onStreamError(payload: StreamError) {
    conversationStore.onStreamError(payload);
  }

  function onTaskUpdated(task: Task): TaskActivityEvent | null {
    const previous = taskIndex.value[task.id] ?? null;
    _replaceTask(task);
    taskIndex.value[task.id] = task;
    const activity = classifyTaskActivity(previous, task);
    if (activity && activeTaskId.value !== task.id) {
      markTaskUnread(task.id);
    }
    // Refresh changed file count when execution completes
    if (task.executionState === "completed") {
      refreshChangedFiles(task.id);
    }
    // Refresh context usage when the active task finishes an execution
    if (
      task.id === activeTaskId.value &&
      task.executionState !== "running"
    ) {
      fetchContextUsage(task.id);
    }
    // Drain queue when task transitions from running to completed (natural finish only)
    if (previous?.executionState === "running" && task.executionState === "completed") {
      drainQueue(task.id);
    }
    return activity;
  }

  function onNewMessage(message: ConversationMessage) {
    conversationStore.onNewMessage(message);
  }

  // ─── Load enabled models (for chat dropdown) ──────────────────────────────────

  async function loadEnabledModels(workspaceKey?: string) {
    await workspaceStore.loadEnabledModels(workspaceKey);
  }

  // Keep loadModels as an alias for backward compat (called from App.vue etc.)
  async function loadModels(workspaceKey?: string) {
    await loadEnabledModels(workspaceKey);
  }

  // ─── Load all provider models (for tree view) ─────────────────────────────────

  async function loadAllModels(workspaceKey?: string) {
    await workspaceStore.loadAllModels(workspaceKey);
  }

  // ─── Toggle model enabled state ─────────────────────────────────────────────────

  async function setModelEnabled(qualifiedModelId: string, enabled: boolean, workspaceKey?: string) {
    await workspaceStore.setModelEnabled(qualifiedModelId, enabled, workspaceKey);
  }

  // ─── Fetch context usage for active task ──────────────────────────────────

  async function fetchContextUsage(taskId: number) {
    const task = taskIndex.value[taskId];
    if (!task) return;
    await conversationStore.fetchContextUsage({ conversationId: task.conversationId });
  }

  // ─── Set model on task ────────────────────────────────────────────────────

  async function setModel(taskId: number, model: string | null) {
    const task = await api("tasks.setModel", { taskId, model });
    _replaceTask(task);
    return task;
  }

  // ─── Cancel running execution ─────────────────────────────────────────────

  async function cancelTask(taskId: number) {
    const task = await api("tasks.cancel", { taskId });
    _replaceTask(task);
    return task;
  }

  // ─── Update task title/description ───────────────────────────────────────

  async function updateTask(taskId: number, title: string, description: string) {
    const task = await api("tasks.update", { taskId, title, description });
    _replaceTask(task);
    return task;
  }

  // ─── Delete task ──────────────────────────────────────────────────────────

  async function deleteTask(taskId: number): Promise<{ warning?: string }> {
    const result = await api("tasks.delete", { taskId });
    for (const [boardId, tasks] of Object.entries(tasksByBoard.value)) {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        tasksByBoard.value[Number(boardId)].splice(idx, 1);
        break;
      }
    }
    if (activeTaskId.value === taskId) {
      activeTaskId.value = null;
      conversationStore.setActiveConversation(null);
    }
    delete taskIndex.value[taskId];
    delete taskQueues.value[taskId];
    clearTaskUnread(taskId);
    return { warning: result.warning };
  }

  // ─── Compact conversation ─────────────────────────────────────────────────

  async function compactTask(taskId: number) {
    await api("tasks.compact", { taskId });
    await loadMessages(taskId);
    await fetchContextUsage(taskId);
  }

  async function getGitStat(taskId: number): Promise<GitNumstat | null> {
    return api("tasks.getGitStat", { taskId });
  }

  // ─── Get changed files (for badge) ───────────────────────────────────────

  async function refreshChangedFiles(taskId: number) {
    try {
      const files = await api("tasks.getChangedFiles", { taskId });
      changedFileCounts.value[taskId] = files.length;
    } catch {
      // ignore — badge stays stale
    }
  }

  function hasUnread(taskId: number): boolean {
    return unreadTaskIds.value.has(taskId);
  }

  function workspaceHasUnread(
    workspaceKey: string,
    boards: Array<{ id: number; workspaceKey: string }>,
  ): boolean {
    return workspaceHasUnreadTasks(workspaceKey, boards, taskIndex.value, unreadTaskIds.value);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  function _replaceTask(updated: Task) {
    for (const [boardId, tasks] of Object.entries(tasksByBoard.value)) {
      const idx = tasks.findIndex((t) => t.id === updated.id);
      if (idx !== -1) {
        // Replace the whole array so Vue detects the change reliably.
        // In-place index assignment (arr[i] = val) can be missed when the
        // component tracks the array reference rather than individual indices.
        tasksByBoard.value[Number(boardId)] = tasks.map((t) => (t.id === updated.id ? updated : t));
        break;
      }
    }
    taskIndex.value[updated.id] = updated;
  }

  // ─── Queue actions ────────────────────────────────────────────────────────

  function enqueueMessage(taskId: number, msg: QueuedMessage) {
    if (!taskQueues.value[taskId]) taskQueues.value[taskId] = emptyQueueState();
    taskQueues.value[taskId].items.push(msg);
  }

  function dequeueMessage(taskId: number, msgId: string) {
    const queue = taskQueues.value[taskId];
    if (!queue) return;
    queue.items = queue.items.filter((i) => i.id !== msgId);
    if (queue.editingId === msgId) queue.editingId = null;
  }

  function startEdit(taskId: number, msgId: string) {
    if (!taskQueues.value[taskId]) return;
    taskQueues.value[taskId].editingId = msgId;
  }

  function confirmEdit(taskId: number, msgId: string, text: string, engineText: string, attachments: import("@shared/rpc-types").Attachment[]) {
    const queue = taskQueues.value[taskId];
    if (!queue) return;
    const idx = queue.items.findIndex((i) => i.id === msgId);
    if (idx !== -1) {
      queue.items[idx] = { ...queue.items[idx], text, engineText, attachments };
    }
    queue.editingId = null;
  }

  function cancelEdit(taskId: number) {
    const queue = taskQueues.value[taskId];
    if (!queue) return;
    queue.editingId = null;
  }

  /** Atomically clears the queue and returns the combined payload, or null if empty. */
  function takeQueue(taskId: number): { text: string; engineText: string; attachments: import("@shared/rpc-types").Attachment[] } | null {
    const queue = taskQueues.value[taskId];
    if (!queue || queue.items.length === 0) return null;
    const items = [...queue.items];
    taskQueues.value[taskId] = emptyQueueState();
    return {
      text: items.map((i) => i.text).join("\n\n---\n\n"),
      engineText: items.map((i) => i.engineText).join("\n\n---\n\n"),
      attachments: items.flatMap((i) => i.attachments),
    };
  }

  async function drainQueue(taskId: number) {
    const payload = takeQueue(taskId);
    if (!payload) return;
    await sendMessage(taskId, payload.text, payload.engineText, payload.attachments.length ? payload.attachments : undefined);
  }

  conversationStore.registerHooks("task-store", {
    onStreamEvent(event, context) {
      if (event.taskId == null) return;
      if (event.type === "file_diff") {
        refreshChangedFiles(event.taskId);
      }
      // Fallback drain: fire when stream ends in case task.updated arrives with
      // unexpected prior state (e.g. WS reconnect missed the running broadcast).
      if (event.type === "done") {
        const task = taskIndex.value[event.taskId];
        if (task?.executionState === "running") {
          drainQueue(event.taskId);
        }
      }
      if (
        event.conversationId !== context.activeConversationId &&
        (event.type === "assistant" || event.type === "reasoning" || event.type === "system" || event.type === "file_diff")
      ) {
        markTaskUnread(event.taskId);
      }
    },
    onNewMessage(message, context) {
      if (message.taskId == null) return;
      if (message.type === "file_diff") {
        refreshChangedFiles(message.taskId);
      }
      if (
        message.conversationId !== context.activeConversationId &&
        (message.type === "assistant" || message.type === "reasoning" || message.type === "system" || message.type === "file_diff")
      ) {
        markTaskUnread(message.taskId);
      }
    },
  });

  return {
    tasksByBoard,
    activeTaskId,
    activeTask,
    messages,
    hasMoreBefore,
    isLoadingOlder,
    streamStates,
    streamVersion,
    activeStreamState,

    loading,
    messagesLoading,
    availableModels,
    allProviderModels,
    contextUsage,
    changedFileCounts,
    unreadTaskIds,
    loadTasks,
    createTask,
    reorderTask,
    reorderColumnBatch,
    transitionTask,
    retryTask,
    sendMessage,
    loadMessages,
    loadOlderMessages,
    selectTask,
    closeTask,
    loadModels,
    loadEnabledModels,
    loadAllModels,
    setModelEnabled,
    fetchContextUsage,
    compactTask,
    setModel,
    cancelTask,
    updateTask,
    deleteTask,
    getGitStat,
    refreshChangedFiles,
    hasUnread,
    workspaceHasUnread,
    onStreamError,
    onStreamEvent,
    onTaskUpdated,
    onNewMessage,
    // Queue
    taskQueues,
    enqueueMessage,
    dequeueMessage,
    startEdit,
    confirmEdit,
    cancelEdit,
    takeQueue,
  };
});
