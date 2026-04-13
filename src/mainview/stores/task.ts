import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { electroview } from "../rpc";
import type { Task, ConversationMessage, StreamToken, StreamError, StreamEvent, StreamEventType, ModelInfo, ProviderModelList, GitNumstat } from "@shared/rpc-types";
import { classifyTaskActivity, workspaceHasUnreadTasks, type TaskActivityEvent } from "../workspace-helpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tryParseJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Extract display-ready text from the orchestrator's JSON tool_result envelope.
 * Works for both Copilot and Claude engines (engine-agnostic).
 */
function extractToolResultText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return raw;
    // Prefer detailedContent (rich text), then joined contents[].text, then content
    if (typeof parsed.detailedContent === "string" && parsed.detailedContent) return parsed.detailedContent;
    if (Array.isArray(parsed.contents)) {
      const texts = parsed.contents
        .filter((c: Record<string, unknown>) => typeof c.text === "string")
        .map((c: Record<string, unknown>) => c.text as string);
      if (texts.length > 0) return texts.join("\n");
    }
    if (typeof parsed.content === "string") return parsed.content;
    return raw;
  } catch {
    return raw;
  }
}

/** Remove live blocks of a given type scoped to a parentBlockId.
 *  Returns the earliest position index for position-preserving insertion,
 *  or -1 if nothing was removed. */
function removeScopedLiveBlocks(
  state: TaskStreamState,
  liveType: string,
  scopeParent: string | null,
): number {
  const toRemove: string[] = [];
  for (const [bid, block] of state.blocks) {
    if (block.type === liveType && block.parentBlockId === scopeParent) {
      toRemove.push(bid);
    }
  }
  if (toRemove.length === 0) return -1;

  const removeSet = new Set(toRemove);
  const list = scopeParent
    ? (state.blocks.get(scopeParent)?.children ?? [])
    : state.roots;

  let earliest = -1;
  for (let i = 0; i < list.length; i++) {
    if (removeSet.has(list[i])) { earliest = i; break; }
  }

  if (scopeParent) {
    const p = state.blocks.get(scopeParent);
    if (p) p.children = p.children.filter(id => !removeSet.has(id));
  } else {
    state.roots = state.roots.filter(id => !removeSet.has(id));
  }
  for (const id of toRemove) state.blocks.delete(id);

  return earliest;
}

// ─── Per-task stream state ────────────────────────────────────────────────────

export interface StreamBlock {
  blockId: string;
  type: StreamEventType;
  content: string;
  metadata: string | null;
  parentBlockId: string | null;
  done: boolean;
  children: string[];
}

export interface TaskStreamState {
  taskId: number;
  executionId: number;
  /** Root-level blockIds (parents with no parentBlockId) */
  roots: string[];
  /** Block content by blockId */
  blocks: Map<string, StreamBlock>;
  /** Whether the execution is complete */
  isDone: boolean;
  /** Ephemeral status message (not stored) */
  statusMessage: string;
}

export const useTaskStore = defineStore("task", () => {
  // All tasks keyed by boardId
  const tasksByBoard = ref<Record<number, Task[]>>({});
  const taskIndex = ref<Record<number, Task>>({});
  const unreadTaskIds = ref(new Set<number>());

  // Active task detail
  const activeTaskId = ref<number | null>(null);
  const messages = ref<ConversationMessage[]>([]);

  // ── Per-task stream states (fixes cross-task contamination) ──
  const streamStates = ref(new Map<number, TaskStreamState>());
  /** Incremented on every onStreamEvent call — watch this for autoscroll during pipeline streaming */
  const streamVersion = ref(0);

  // Legacy streaming refs (kept for backward compat with old engine path)
  const streamingToken = ref("");
  const streamingTaskId = ref<number | null>(null);
  const streamingReasoningToken = ref("");
  const isStreamingReasoning = ref(false);
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

  const activeStreamState = computed(() => {
    return activeTaskId.value != null ? streamStates.value.get(activeTaskId.value) ?? null : null;
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
      // If there is an active stream state for this task, merge DB messages into it
      // to avoid showing duplicates from both sources
      const existingState = streamStates.value.get(taskId);
      if (existingState) {
        // Remove blocks that correspond to DB messages (they'll be in messages[])
        const persistedTypes: StreamEventType[] = ["assistant", "reasoning", "tool_call", "tool_result", "file_diff", "user", "system"];
        const liveOnlyIds = new Set<string>();
        const toRemove = new Set<string>();
        
        // Mark persisted blocks for removal
        for (const [bid, block] of existingState.blocks) {
          if (persistedTypes.includes(block.type as StreamEventType)) {
            toRemove.add(bid);
          }
        }
        
        // Remove persisted blocks and rebuild roots
        for (const bid of toRemove) {
          existingState.blocks.delete(bid);
        }
        
        // Rebuild roots: only non-persisted blocks with no parent
        existingState.roots = [];
        for (const [bid, block] of existingState.blocks) {
          if (!block.parentBlockId) {
            existingState.roots.push(bid);
          }
        }
        streamStates.value = new Map(streamStates.value);
      }
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

  /** New unified stream event handler — replaces the three-channel old approach */
  function onStreamEvent(event: StreamEvent) {
    // Bump version so watchers (e.g. autoscroll) fire on every event
    streamVersion.value++;

    // ── Diagnostic: verify events arrive incrementally ──
    if (event.type === "text_chunk" || event.type === "reasoning_chunk") {
      console.log(`[stream-diag] ${event.type} len=${event.content.length} ver=${streamVersion.value} t=${performance.now().toFixed(1)}`);
    }
    if (event.type === "file_diff") {
      refreshChangedFiles(event.taskId);
    }

    // Mark unread for non-active tasks on content events
    if (event.taskId !== activeTaskId.value &&
      (event.type === "assistant" || event.type === "reasoning" || event.type === "system" || event.type === "file_diff")
    ) {
      markTaskUnread(event.taskId);
    }

    // Ensure a state entry exists for this task
    let state = streamStates.value.get(event.taskId);
    if (!state) {
      state = {
        taskId: event.taskId,
        executionId: event.executionId,
        roots: [],
        blocks: new Map(),
        isDone: false,
        statusMessage: "",
      };
      streamStates.value.set(event.taskId, state);
    } else if (state.executionId !== event.executionId) {
      // New execution started for this task — reset live stream state so the
      // previous run's isDone=true doesn't hide the new execution's content.
      state.roots = [];
      state.blocks = new Map();
      state.isDone = false;
      state.statusMessage = "";
      state.executionId = event.executionId;
    }

    if (event.type === "done") {
      state.isDone = true;
      state.statusMessage = "";
      // Mark live blocks as done (preserves content on cancel/completion).
      const liveTypes = new Set(["text_chunk", "reasoning_chunk"]);
      for (const [, block] of state.blocks) {
        if (liveTypes.has(block.type)) {
          block.done = true;
        }
      }
      streamStates.value = new Map(streamStates.value);
      // Reload DB messages now that streaming is done — stream blocks were the
      // sole renderer during streaming, so messages[] needs to catch up.
      if (event.taskId === activeTaskId.value) {
        loadMessages(event.taskId);
      }
      return;
    }

    if (event.type === "status_chunk") {
      state.statusMessage = event.content;
      streamStates.value = new Map(streamStates.value);
      return;
    }

    // For chunks, append to existing live block or create one
    if (event.type === "text_chunk" || event.type === "reasoning_chunk") {
      const blockType = event.type === "text_chunk" ? "text_chunk" : "reasoning_chunk";
      // Find existing live block of same type with matching parent
      let lastBlockId = undefined;
      let lastBlock = undefined;
      
      // Search from end of roots (or bottom of parent's children)
      if (event.parentBlockId) {
        const parentBlock = state.blocks.get(event.parentBlockId);
        if (parentBlock) {
          lastBlockId = parentBlock.children.at(-1);
          lastBlock = lastBlockId ? state.blocks.get(lastBlockId) : undefined;
        }
      } else {
        // Root level: find from end of roots
        lastBlockId = state.roots.at(-1);
        lastBlock = lastBlockId ? state.blocks.get(lastBlockId) : undefined;
      }

      if (lastBlock && lastBlock.type === blockType && !lastBlock.done) {
        // Append to existing live block
        lastBlock.content += event.content;
      } else {
        // Start new live block
        const newBlockId = `live-${blockType}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const newBlock: StreamBlock = {
          blockId: newBlockId,
          type: blockType,
          content: event.content,
          metadata: null,
          parentBlockId: event.parentBlockId ?? null,
          done: false,
          children: [],
        };
        state.blocks.set(newBlockId, newBlock);
        
        // Add to parent's children or to roots
        if (event.parentBlockId) {
          const parentBlock = state.blocks.get(event.parentBlockId);
          if (parentBlock) {
            parentBlock.children.push(newBlockId);
          }
        } else {
          state.roots.push(newBlockId);
        }
      }
      streamStates.value = new Map(streamStates.value);
      return;
    }

    // For persisted events (assistant, reasoning, tool_call, tool_result, file_diff, user, system)
    // Place block in tree based on parentBlockId
    const blockId = event.blockId || `${event.type}-${event.seq || Date.now()}`;
    const eventScope = event.parentBlockId ?? null;

    // When a persisted block replaces live blocks, record their position
    // so the persisted block takes the same slot (preserves order).
    let insertIdx = -1;

    if (event.type === "tool_call") {
      // Clear live reasoning_chunks at the same scope (not globally)
      insertIdx = removeScopedLiveBlocks(state, "reasoning_chunk", eventScope);
    }

    if (event.type === "assistant") {
      // Replace live text_chunks at the same scope only
      insertIdx = removeScopedLiveBlocks(state, "text_chunk", eventScope);
    }

    if (event.type === "reasoning") {
      // Replace live reasoning_chunks at the same scope only
      insertIdx = removeScopedLiveBlocks(state, "reasoning_chunk", eventScope);
    }

    // Add persisted block if not already present
    if (!state.blocks.has(blockId)) {
      const newBlock: StreamBlock = {
        blockId,
        type: event.type,
        content: event.content,
        metadata: event.metadata,
        parentBlockId: event.parentBlockId ?? null,
        done: true,
        children: [],
      };
      state.blocks.set(blockId, newBlock);
      
      // Place in tree — at the position of replaced live blocks if available
      if (event.parentBlockId) {
        const parentBlock = state.blocks.get(event.parentBlockId);
        if (parentBlock) {
          if (insertIdx >= 0) {
            parentBlock.children.splice(insertIdx, 0, blockId);
          } else {
            parentBlock.children.push(blockId);
          }
        } else {
          // Parent missing (orphan): promote to root
          if (insertIdx >= 0) {
            state.roots.splice(insertIdx, 0, blockId);
          } else {
            state.roots.push(blockId);
          }
        }
      } else {
        if (insertIdx >= 0) {
          state.roots.splice(insertIdx, 0, blockId);
        } else {
          state.roots.push(blockId);
        }
      }
    } else if (event.type === "tool_result") {
      // tool_result shares blockId with its tool_call — update the existing block
      const existing = state.blocks.get(blockId)!;
      existing.done = true;
      // Store result content in metadata for the renderer to display
      const resultMeta = {
        ...(existing.metadata ? tryParseJson(existing.metadata) : {}),
        hasResult: true,
        resultContent: extractToolResultText(event.content),
        resultMetadata: event.metadata,
      };
      existing.metadata = JSON.stringify(resultMeta);
    }

    streamStates.value = new Map(streamStates.value);
  }

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
    // While stream blocks own the live rendering, suppress DB message pushes
    // to avoid dual rendering (same content in virtual list + stream blocks).
    // Messages will be loaded from DB when the stream is done.
    const streamState = streamStates.value.get(message.taskId);
    if (streamState && !streamState.isDone) return;
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
    onStreamEvent,
    onTaskUpdated,
    onNewMessage,
  };
});
