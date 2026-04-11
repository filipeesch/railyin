import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { electroview } from "../rpc";
import type { Task, ConversationMessage, StreamToken, StreamError, ModelInfo, ProviderModelList, GitNumstat } from "@shared/rpc-types";
import { classifyTaskActivity, workspaceHasUnreadTasks, type TaskActivityEvent } from "../workspace-helpers";

export const useTaskStore = defineStore("task", () => {
  // All tasks keyed by boardId
  const tasksByBoard = ref<Record<number, Task[]>>({});
  const taskIndex = ref<Record<number, Task>>({});
  const unreadTaskIds = ref(new Set<number>());

  // Active task detail
  const activeTaskId = ref<number | null>(null);
  const messages = ref<ConversationMessage[]>([]);
  const streamingToken = ref("");     // accumulates current stream
  const streamingTaskId = ref<number | null>(null);   // which task is streaming

  // Reasoning display (task 4.1-4.3)
  const streamingReasoningToken = ref("");   // live reasoning text for active round
  const isStreamingReasoning = ref(false);   // true while reasoning tokens are arriving

  // Ephemeral status message during non-streaming fallback (never stored in DB)
  const streamingStatusMessage = ref("");

  const loading = ref(false);
  const messagesLoading = ref(false);

  // Enabled models for the chat dropdown (flat, only user-enabled)
  const availableModels = ref<ModelInfo[]>([]);

  // All provider models for the tree view (grouped by provider)
  const allProviderModels = ref<ProviderModelList[]>([]);

  // Context usage for the active task (stale-on-load, updated after executions)
  const contextUsage = ref<{ usedTokens: number; maxTokens: number; fraction: number } | null>(null);

  // Changed file counts per task (populated from file_diff events and task completion)
  const changedFileCounts = ref<Record<number, number>>({});

  const activeTask = computed(() => {
    return activeTaskId.value != null ? taskIndex.value[activeTaskId.value] ?? null : null;
  });

  function sortMessagesInPlace() {
    messages.value = [...messages.value].sort((a, b) => a.id - b.id);
  }

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
      const tasks = await electroview.rpc.request["tasks.list"]({ boardId });
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
    projectId: number;
    title: string;
    description: string;
  }) {
    const task = await electroview.rpc.request["tasks.create"](params);
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
      const task = await electroview.rpc.request["tasks.reorder"]({ taskId, position });
      _replaceTask(task);
      return task;
    } catch (err) {
      if (prior) _replaceTask(prior);
      throw err;
    }
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
      const { task } = await electroview.rpc.request["tasks.transition"]({
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
    sortMessagesInPlace();
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
      sortMessagesInPlace();
    } finally {
      messagesLoading.value = false;
    }
  }

  // ─── Select task (opens detail) ───────────────────────────────────────────

  async function selectTask(taskId: number) {
    activeTaskId.value = taskId;
    clearTaskUnread(taskId);
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
      // The assistant message was already delivered and the bubble cleared via onNewMessage.
      // Just clean up remaining streaming state — no DB refetch needed.
      streamingToken.value = "";
      streamingReasoningToken.value = "";
      streamingStatusMessage.value = "";
      isStreamingReasoning.value = false;
      streamingTaskId.value = null;
    } else if (payload.isStatus) {
      // Ephemeral status event from non-streaming fallback: just update the latest message.
      streamingStatusMessage.value = payload.token;
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
      streamingStatusMessage.value = ""; // clear status when real tokens arrive
      streamingToken.value += payload.token;
    }
  }

  function onStreamError(payload: StreamError) {
    if (payload.taskId !== streamingTaskId.value) return;
    streamingToken.value = "";
    streamingStatusMessage.value = "";
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
    sortMessagesInPlace();
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
    // Prime streaming state as soon as execution starts. The engine always sends
    // task.updated → running before emitting any stream.token, so setting
    // streamingTaskId here guarantees tokens are never dropped by the early-return
    // guard in onStreamToken. This also covers auto-executions triggered by
    // handleTransition (on_enter_prompt), which never go through sendMessage.
    if (task.executionState === "running" && streamingTaskId.value === null) {
      streamingTaskId.value = task.id;
      streamingToken.value = "";
      streamingReasoningToken.value = "";
      streamingStatusMessage.value = "";
      isStreamingReasoning.value = false;
    }
    // Refresh context usage when the active task finishes an execution
    if (
      task.id === activeTaskId.value &&
      task.executionState !== "running"
    ) {
      fetchContextUsage(task.id);
    }
    return activity;
  }

  function onNewMessage(message: ConversationMessage) {
    // Refresh changed file count when a file_diff arrives
    if (message.type === "file_diff") {
      refreshChangedFiles(message.taskId);
    }
    if (
      message.taskId !== activeTaskId.value &&
      (message.type === "assistant" ||
        message.type === "reasoning" ||
        message.type === "system" ||
        message.type === "file_diff")
    ) {
      markTaskUnread(message.taskId);
    }
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
    // When the persisted assistant message arrives, clear the streaming bubble — the
    // real message replaces it instantly with no gap. streamingTaskId is left for the
    // subsequent onStreamToken(done) to clear so its guard still fires.
    if (message.type === "assistant" && message.taskId === streamingTaskId.value) {
      streamingToken.value = "";
    }
    messages.value.push(message);
    sortMessagesInPlace();
  }

  // ─── Load enabled models (for chat dropdown) ──────────────────────────────────

  async function loadEnabledModels(workspaceId?: number) {
    availableModels.value = await electroview.rpc.request["models.listEnabled"]({ workspaceId });
  }

  // Keep loadModels as an alias for backward compat (called from App.vue etc.)
  async function loadModels(workspaceId?: number) {
    await loadEnabledModels(workspaceId);
  }

  // ─── Load all provider models (for tree view) ─────────────────────────────────

  async function loadAllModels(workspaceId?: number) {
    allProviderModels.value = await electroview.rpc.request["models.list"]({ workspaceId });
  }

  // ─── Toggle model enabled state ─────────────────────────────────────────────────

  async function setModelEnabled(qualifiedModelId: string, enabled: boolean, workspaceId?: number) {
    await electroview.rpc.request["models.setEnabled"]({ workspaceId, qualifiedModelId, enabled });
    // Optimistic update in allProviderModels
    for (const provider of allProviderModels.value) {
      const model = provider.models.find((m) => m.id === qualifiedModelId);
      if (model) {
        model.enabled = enabled;
        break;
      }
    }
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
    delete taskIndex.value[taskId];
    clearTaskUnread(taskId);
    return { warning: result.warning };
  }

  // ─── Compact conversation ─────────────────────────────────────────────────

  async function compactTask(taskId: number) {
    await electroview.rpc.request["tasks.compact"]({ taskId });
    await loadMessages(taskId);
    await fetchContextUsage(taskId);
  }

  async function getGitStat(taskId: number): Promise<GitNumstat | null> {
    return electroview.rpc.request["tasks.getGitStat"]({ taskId });
  }

  // ─── Get changed files (for badge) ───────────────────────────────────────

  async function refreshChangedFiles(taskId: number) {
    try {
      const files = await electroview.rpc.request["tasks.getChangedFiles"]({ taskId });
      changedFileCounts.value[taskId] = files.length;
    } catch {
      // ignore — badge stays stale
    }
  }

  function hasUnread(taskId: number): boolean {
    return unreadTaskIds.value.has(taskId);
  }

  function workspaceHasUnread(
    workspaceId: number,
    boards: Array<{ id: number; workspaceId: number }>,
  ): boolean {
    return workspaceHasUnreadTasks(workspaceId, boards, taskIndex.value, unreadTaskIds.value);
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

  return {
    tasksByBoard,
    activeTaskId,
    activeTask,
    messages,
    streamingToken,
    streamingReasoningToken,
    isStreamingReasoning,
    streamingStatusMessage,
    streamingTaskId,
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
    transitionTask,
    retryTask,
    sendMessage,
    loadMessages,
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
    onStreamToken,
    onStreamError,
    onTaskUpdated,
    onNewMessage,
  };
});
