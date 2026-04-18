<template>
  <!-- Resize handle sits outside the Drawer so it can overlap its left edge -->
  <div
    v-if="open"
    class="drawer-resize-handle"
    :style="{ right: drawerWidth + 'px' }"
    @mousedown.stop.prevent="startResize"
    @click.stop
  />
  <Drawer
    v-model:visible="open"
    position="right"
    :style="{ width: drawerWidth + 'px' }"
    :modal="false"
    :dismissable="false"
    @hide="onHide"
  >
    <template #header>
      <div class="drawer-header" v-if="task">
        <span class="drawer-header__title">{{ task.title }}</span>
        <Tag
          :value="execLabel"
          :severity="execSeverity"
          rounded
          class="ml-2"
        />
        <!-- Changed files badge removed — see ChangedFilesPanel below chat -->
        <Button
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          class="ml-auto"
          v-tooltip="'Sync changed files'"
          :loading="syncingChanges"
          @click="syncChangedFiles"
        />
        <!-- Delete button -->
        <Button
          icon="pi pi-trash"
          text
          rounded
          size="small"
          severity="danger"
          v-tooltip="'Delete task'"
          @click="confirmDelete"
        />
      </div>
    </template>

    <div v-if="task" class="task-detail">
      <!-- Persistent toolbar: tabs (left) + action cluster (right) -->
      <div class="drawer-toolbar">
        <div class="tab-switcher">
          <button
            :class="['tab-btn', { 'tab-btn--active': activeTab === 'chat' }]"
            @click="activeTab = 'chat'"
          >
            <i class="pi pi-comments" />
            Chat
          </button>
          <button
            :class="['tab-btn', { 'tab-btn--active': activeTab === 'info' }]"
            @click="activeTab = 'info'"
          >
            <i class="pi pi-info-circle" />
            Info
          </button>
        </div>
        <div class="toolbar-actions">
          <Select
            v-if="columns.length"
            :model-value="task.workflowState"
            :options="columns"
            option-label="label"
            option-value="id"
            size="small"
            class="workflow-select"
            :disabled="transitioning"
            @change="(e: { value: string }) => transition(e.value)"
          />
          <Button
            v-if="task.worktreePath"
            icon="pi pi-desktop"
            text
            size="small"
            v-tooltip="'Open terminal at worktree'"
            @click="openTerminal"
          />
          <Button
            v-if="task.executionState === 'failed'"
            label="Retry"
            icon="pi pi-replay"
            severity="warn"
            size="small"
            :loading="retrying"
            @click="retry"
          />
          <LaunchButtons
            v-if="launchConfig"
            :profiles="launchConfig.profiles"
            :tools="launchConfig.tools"
            @run="runLaunch"
          />
        </div>
      </div>

      <!-- Chat tab -->
      <div v-if="activeTab === 'chat'" class="task-tab-chat">

        <!-- Conversation timeline -->
        <div class="task-detail__conversation" ref="scrollEl" @scroll.passive="onScroll">

          <div class="conversation-inner">
            <!-- Virtual list spacer: only visible items are in the DOM -->
            <div :style="{ position: 'relative', height: `${virtualizer.getTotalSize()}px` }">
              <div
                v-for="vitem in virtualizer.getVirtualItems()"
                :key="vitem.key"
                :ref="measureRef"
                :data-index="vitem.index"
                :style="{
                  position: 'absolute',
                  top: 0,
                  width: '100%',
                  paddingBottom: '8px',
                  transform: `translateY(${vitem.start}px)`,
                }"
              >
                <ToolCallGroup
                  v-if="displayItems[vitem.index].kind === 'tool_entry'"
                  :entry="asToolEntry(vitem.index).entry"
                />
                <CodeReviewCard
                  v-else-if="displayItems[vitem.index].kind === 'code_review'"
                  :message="asCodeReview(vitem.index).message"
                />
                <MessageBubble
                  v-else
                  :chunk="asSingle(vitem.index).message"
                  :index="asSingle(vitem.index).msgIndex"
                />
              </div>
            </div>

            <!-- Unified stream blocks: recursive tree render (roots → children via DFS) -->
            <template v-if="taskStore.activeStreamState && taskStore.activeStreamState.roots.length > 0">
              <StreamBlockNode
                v-for="rootId in taskStore.activeStreamState.roots"
                :key="rootId"
                :blockId="rootId"
                :blocks="taskStore.activeStreamState.blocks"
                :renderMd="renderMd"
                :version="taskStore.streamVersion"
              />
            </template>
            <!-- Ephemeral status message (outside roots guard so it shows before any blocks arrive) -->
            <div
              v-if="taskStore.activeStreamState && !taskStore.activeStreamState.isDone && taskStore.activeStreamState.statusMessage"
              class="msg msg--system msg--status-ephemeral"
            >
              <ProgressSpinner style="width: 16px; height: 16px" />
              <span>{{ taskStore.activeStreamState.statusMessage }}</span>
            </div>

            <!-- Fallback: legacy streaming (non-pipeline engine path) -->
            <template v-else-if="!taskStore.activeStreamState">
              <!-- Live streaming reasoning bubble -->
              <ReasoningBubble
                v-if="taskStore.streamingReasoningToken && taskStore.streamingTaskId === task.id"
                :content="taskStore.streamingReasoningToken"
                :streaming="taskStore.isStreamingReasoning"
                key="live-reasoning"
              />
              <!-- Live streaming text bubble -->
              <div
                v-if="taskStore.streamingToken && taskStore.streamingTaskId === task.id"
                class="msg msg--assistant"
              >
                <div class="msg__bubble prose streaming" v-html="renderMd(taskStore.streamingToken)" />
                <div class="msg__meta">AI<span class="cursor">▌</span></div>
              </div>
              <!-- Ephemeral status (legacy) -->
              <div
                v-else-if="taskStore.streamingStatusMessage && taskStore.streamingTaskId === task.id"
                class="msg msg--system msg--status-ephemeral"
              >
                <ProgressSpinner style="width: 16px; height: 16px" />
                <span>{{ taskStore.streamingStatusMessage }}</span>
              </div>
            </template>

            <!-- Running spinner when no tokens yet -->
            <div
              v-if="task.executionState === 'running' && !hasLiveContent"
              class="msg msg--system"
            >
              <ProgressSpinner style="width: 20px; height: 20px" />
              <span>Thinking…</span>
            </div>

            <!-- Context warning -->
            <div v-if="contextWarning" class="context-warning">
              <i class="pi pi-exclamation-triangle" />
              {{ contextWarning }}
            </div>
          </div>
        </div>

        <!-- Changed files panel — visible when task has git changes -->
        <ChangedFilesPanel
          v-if="task && numstat"
          :task-id="task.id"
          :numstat="numstat"
          :pending-by-file="pendingByFile"
          @open-review="onOpenReview"
        />

        <!-- Todo panel -->
        <TodoPanel
          v-if="task"
          :task-id="task.id"
          :refresh-trigger="todoRefreshTrigger"
          :board-id="task.boardId"
          :workflow-state="task.workflowState"
        />
      <div class="task-detail__input">
        <!-- Pending attachment chips -->
        <div v-if="pendingAttachments.length > 0" class="task-detail__attachments">
          <span
            v-for="(att, idx) in pendingAttachments"
            :key="idx"
            class="attachment-chip"
          >
            📎 {{ att.label }}
            <button class="attachment-chip__remove" @click="pendingAttachments.splice(idx, 1)" aria-label="Remove attachment">✕</button>
          </span>
        </div>
        <!-- Hidden file input -->
        <input
          ref="fileInputRef"
          type="file"
          accept="*"
          multiple
          style="display: none"
          @change="onFileInputChange"
        />
        <div class="task-detail__input-row">
          <Textarea
            v-model="inputText"
            placeholder="Send a message… (Shift+Enter for newline)"
            class="flex-1"
            rows="1"
            autoResize
            :disabled="task.executionState === 'running' || compacting"
            @keydown.enter.exact.prevent="send"
            @paste="onPaste"
          />
          <!-- Attach button — only shown when not running/compacting -->
          <Button
            v-if="task.executionState !== 'running' && !compacting"
            icon="pi pi-paperclip"
            text
            rounded
            size="small"
            v-tooltip="'Attach image'"
            @click="fileInputRef?.click()"
          />
          <!-- Context-aware send / cancel / compacting button -->
          <Button
            v-if="task.executionState === 'running'"
            icon="pi pi-stop-circle"
            severity="warn"
            @click="cancel"
          />
          <Button
            v-else-if="compacting"
            :loading="true"
            :disabled="true"
          />
          <Button
            v-else
            icon="pi pi-send"
            :disabled="!inputText.trim()"
            @click="send"
          />
        </div>
        <!-- Model selector + context gauge -->
        <div class="task-detail__model-row">
          <!-- Populated: searchable grouped Select -->
          <template v-if="taskStore.availableModels.length > 0">
            <Select
              :model-value="task.model ?? taskStore.availableModels[0]?.id ?? null"
              :options="groupedModels"
              option-group-label="label"
              option-group-children="items"
              option-label="label"
              option-value="id"
              filter
              filter-placeholder="Search models…"
              size="small"
              class="input-model-select"
              @change="(e: { value: string | null }) => onModelChange(e.value)"
            >
              <template #value="{ value, placeholder }">
                <span v-if="selectedModelOption" class="model-select__value" :title="selectedModelOption.description ?? selectedModelOption.id ?? undefined">
                  {{ selectedModelOption.label }}
                </span>
                <span v-else class="p-select-label p-placeholder">{{ placeholder }}</span>
              </template>
              <template #option="{ option }">
                <div class="model-select__option" :title="option.description ?? option.id ?? undefined">
                  <div class="model-select__option-title">{{ option.label }}</div>
                  <div v-if="option.description" class="model-select__option-description">{{ option.description }}</div>
                  <div v-if="option.id" class="model-select__option-id">{{ option.id }}</div>
                </div>
              </template>
              <template #footer>
                <div class="model-select-footer">
                  <Button
                    label="⚙ Manage models"
                    text
                    size="small"
                    @click="manageModelsOpen = true"
                  />
                </div>
              </template>
            </Select>
          </template>

          <!-- Empty state: no models enabled -->
          <template v-else>
            <div class="model-empty-state">
              <span class="model-empty-label">No models enabled</span>
              <Button
                label="⚙ Manage models"
                text
                size="small"
                @click="manageModelsOpen = true"
              />
            </div>
          </template>
          <!-- Context ring gauge -->
          <svg
            v-if="taskStore.contextUsage"
            class="context-ring"
            width="28"
            height="28"
            viewBox="0 0 28 28"
            :title="`~${taskStore.contextUsage.usedTokens.toLocaleString()} / ${taskStore.contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(taskStore.contextUsage.fraction * 100)}%)`"
          >
            <!-- track -->
            <circle cx="14" cy="14" r="10" fill="none" stroke-width="3" class="context-ring__track" />
            <!-- fill arc -->
            <circle
              cx="14" cy="14" r="10" fill="none" stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray="62.83"
              :stroke-dashoffset="62.83 * (1 - taskStore.contextUsage.fraction)"
              :stroke="taskStore.contextUsage.fraction >= 0.90 ? 'var(--p-red-500, #ef4444)' : taskStore.contextUsage.fraction >= 0.70 ? 'var(--p-yellow-500, #eab308)' : 'var(--p-green-500, #22c55e)'"
              transform="rotate(-90 14 14)"
            />
            <!-- percentage label -->
            <text
              v-if="taskStore.contextUsage.fraction > 0"
              x="14" y="18"
              text-anchor="middle"
              font-size="7"
              class="context-ring__label"
            >{{ Math.round(taskStore.contextUsage.fraction * 100) }}%</text>
          </svg>
          <!-- Compact button -->
          <Button
            label="Compact"
            size="small"
            text
            :disabled="task.executionState === 'running' || compacting"
            :loading="compacting"
            @click="compactConversation"
          />
          <!-- Shell auto-approve toggle -->
          <div class="shell-autoapprove-toggle" :title="task.shellAutoApprove ? 'Shell auto-approve ON — commands run without prompting' : 'Shell auto-approve OFF — commands require approval'">
            <ToggleSwitch
              :model-value="task.shellAutoApprove"
              size="small"
              @update:model-value="toggleShellAutoApprove"
            />
            <span class="shell-autoapprove-label">Auto-approve shell</span>
          </div>
          <!-- MCP Tools button -->
          <Button
            v-if="mcpStatus.length > 0"
            v-tooltip="'MCP Tools'"
            icon="pi pi-wrench"
            :severity="mcpHasWarning ? 'danger' : 'secondary'"
            text
            rounded
            size="small"
            class="task-detail__mcp-btn"
            @click="onMcpBtnClick"
          />
          <McpToolsPopover
            v-if="mcpStatus.length > 0"
            ref="mcpPopoverRef"
            :task-id="task.id"
            :enabled-mcp-tools="task.enabledMcpTools ?? null"
            @edit-config="onMcpEditConfig"
            @tools-changed="onMcpToolsChanged"
          />
        </div>
      </div>
      <FileEditorOverlay
        :visible="mcpEditorVisible"
        title="Edit mcp.json"
        :content="mcpConfigContent"
        language="json"
        note="Editing global MCP server configuration (~/.railyn/mcp.json). Save to reload servers."
        @close="mcpEditorVisible = false"
        @save="onMcpConfigSave"
      />
      </div><!-- end task-tab-chat -->

      <!-- Info tab -->
      <div v-else-if="activeTab === 'info'" class="task-tab-info">
        <TaskInfoTab
          :task="task"
          :board="currentBoard"
          @edit="openTaskOverlay"
        />
      </div>

    </div>
  </Drawer>

  <!-- Manage models modal -->
  <ManageModelsModal
    v-model="manageModelsOpen"
    :workspace-key="taskWorkspaceKey"
    @close="onManageModelsClosed"
  />

  <!-- Delete confirm dialog -->
  <Dialog v-model:visible="deleteDialogVisible" header="Delete task" :modal="true" :style="{ width: '420px' }">
    <p>Are you sure you want to delete <strong>{{ task?.title }}</strong>?</p>
    <p class="delete-warn">This will remove the worktree and all conversation history. The branch will be kept.</p>
    <div v-if="deleteWarning" class="dialog-warning">
      <i class="pi pi-exclamation-triangle" />
      Task deleted. {{ deleteWarning }}
    </div>
    <div v-if="deleteError" class="dialog-error">
      <i class="pi pi-exclamation-circle" />
      {{ deleteError }}
    </div>
    <template #footer>
      <Button label="Cancel" text @click="deleteDialogVisible = false; deleteError = null; deleteWarning = null" />
      <Button label="Delete" severity="danger" :loading="deleteLoading" :disabled="!!deleteWarning" @click="deleteTask" />
    </template>
  </Dialog>

  <!-- Task Detail Overlay -->
  <TaskDetailOverlay
    v-if="task"
    :visible="taskOverlayVisible"
    :task-id="task.id"
    :board-id="task.boardId"
    @close="taskOverlayVisible = false"
    @saved="onTaskSaved"
    @deleted="onTaskDeleted"
  />

  <!-- PTY terminal is now shown in the bottom terminal panel -->
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { marked } from "marked";
import Drawer from "primevue/drawer";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import ProgressSpinner from "primevue/progressspinner";
import ToggleSwitch from "primevue/toggleswitch";
import MessageBubble from "./MessageBubble.vue";
import ToolCallGroup from "./ToolCallGroup.vue";
import { pairToolMessages, type ToolEntry } from "../utils/pairToolMessages";
import ReasoningBubble from "./ReasoningBubble.vue";
import StreamBlockNode from "./StreamBlockNode.vue";
import CodeReviewCard from "./CodeReviewCard.vue";
import ManageModelsModal from "./ManageModelsModal.vue";
import TodoPanel from "./TodoPanel.vue";
import ChangedFilesPanel from "./ChangedFilesPanel.vue";
import LaunchButtons from "./LaunchButtons.vue";
import TaskDetailOverlay from "./TaskDetailOverlay.vue";
import TaskInfoTab from "./TaskInfoTab.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";
import { useToast } from "primevue/usetoast";
import { useReviewStore } from "../stores/review";
import { useLaunchStore } from "../stores/launch";
import { useTerminalStore } from "../stores/terminal";
import { api } from "../rpc";
import McpToolsPopover from "./McpToolsPopover.vue";
import FileEditorOverlay from "./FileEditorOverlay.vue";
import type { ConversationMessage, ExecutionState, LaunchConfig, GitNumstat, Attachment, McpServerStatus, Task } from "@shared/rpc-types";

const taskStore = useTaskStore();
const boardStore = useBoardStore();
const toast = useToast();
const reviewStore = useReviewStore();
const launchStore = useLaunchStore();
const terminalStore = useTerminalStore();

const activeTab = ref<'chat' | 'info'>('chat');

const currentBoard = computed(() =>
  task.value ? (boardStore.boards.find(b => b.id === task.value!.boardId) ?? null) : null
);

const launchConfig = ref<LaunchConfig | null>(null);

async function runLaunch(command: string, mode: "terminal" | "app") {
  if (!task.value) return;
  const result = await launchStore.run(task.value.id, command, mode);
  if (!result.ok) {
    toast.add({ severity: "error", summary: "Launch failed", detail: result.error, life: 5000 });
  } else if (result.sessionId) {
    terminalStore.addSession(result.sessionId, task.value.title, task.value.worktreePath ?? "");
  }
}

const manageModelsOpen = ref(false);

// ─── MCP Tools state ──────────────────────────────────────────────────────────

const mcpStatus = ref<McpServerStatus[]>([]);
const mcpPopoverRef = ref<InstanceType<typeof McpToolsPopover> | null>(null);
const mcpEditorVisible = ref(false);
const mcpConfigContent = ref("{}");

const mcpHasWarning = computed(() => mcpStatus.value.some(s => s.state === "error"));

function onMcpBtnClick(event: MouseEvent) {
  mcpPopoverRef.value?.toggle(event);
}

async function onMcpEditConfig() {
  try {
    const result = await api("mcp.getConfig", {});
    mcpConfigContent.value = result.content;
    mcpEditorVisible.value = true;
  } catch (err) {
    console.error("Failed to load mcp config", err);
  }
}

async function onMcpConfigSave(content: string) {
  await api("mcp.saveConfig", { content });
  mcpEditorVisible.value = false;
  try {
    mcpStatus.value = await api("mcp.getStatus", {});
  } catch { /* ignore */ }
}

function onMcpToolsChanged(updatedTask: Task) {
  console.log("[TaskDetailDrawer] MCP tools changed for task", updatedTask.id);
}

async function onManageModelsClosed() {
  await taskStore.loadEnabledModels(taskWorkspaceKey.value);
}

const groupedModels = computed(() => {
  const groups: Record<string, Array<{ id: string | null; label: string; description?: string; contextWindow: number | null }>> = {};
  for (const model of taskStore.availableModels) {
    const provider = model.id == null
      ? "copilot"
      : (model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : "other");
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push({
      id: model.id,
      label: model.displayName ?? model.id ?? "Auto",
      description: model.description,
      contextWindow: model.contextWindow,
    });
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
});

const selectedModelOption = computed(() => {
  const selectedId = task.value ? task.value.model : (taskStore.availableModels[0]?.id ?? null);
  for (const group of groupedModels.value) {
    const found = group.items.find((item) => item.id === selectedId);
    if (found) return found;
  }
  return null;
});

const changedCount = computed(() => task.value ? (taskStore.changedFileCounts[task.value.id] ?? 0) : 0);
const syncingChanges = ref(false);

async function openReviewOverlay(filePath?: string | null, mode: "review" | "changes" = "review") {
  if (!task.value) return;
  const files = await api("tasks.getChangedFiles", { taskId: task.value.id });
  reviewStore.openReview(task.value.id, files);
  reviewStore.mode = mode;
  if (filePath) reviewStore.selectFile(filePath);
}

async function onOpenReview(filePath: string | null, mode: "review" | "changes") {
  await openReviewOverlay(filePath, mode);
  // Refresh pending summary after reviewing
  if (task.value) {
    try {
      pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
    } catch { /* non-fatal */ }
  }
}

async function syncChangedFiles() {
  if (!task.value) return;
  syncingChanges.value = true;
  try {
    await taskStore.refreshChangedFiles(task.value.id);
    numstat.value = await taskStore.getGitStat(task.value.id);
    pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
  } finally {
    syncingChanges.value = false;
  }
}

// ─── Message grouping ─────────────────────────────────────────────────────────
// Consecutive tool_call / tool_result / file_diff messages are collapsed into a
// single ToolCallGroup accordion, matching the Cursor / Copilot UX pattern.

const TOOL_MSG_TYPES = new Set(["tool_call", "tool_result", "file_diff"]);

type DisplayItem =
  | { kind: "tool_entry"; entry: ToolEntry; key: string }
  | { kind: "code_review"; message: ConversationMessage; key: string }
  | { kind: "single";     message: ConversationMessage; msgIndex: number; key: string };

const displayItems = computed<DisplayItem[]>(() => {
  const msgs = taskStore.messages;
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < msgs.length) {
    if (msgs[i].type === "code_review") {
      items.push({ kind: "code_review", message: msgs[i], key: `cr-${msgs[i].id}` });
      i++;
      // Skip the companion LLM-facing user message (always stored immediately after code_review)
      if (i < msgs.length && msgs[i].type === "user" && msgs[i].content.startsWith("=== Code Review ===")) {
        i++;
      }
    } else if (TOOL_MSG_TYPES.has(msgs[i].type)) {
      const toolMsgs: ConversationMessage[] = [];
      while (i < msgs.length && TOOL_MSG_TYPES.has(msgs[i].type)) {
        toolMsgs.push(msgs[i]);
        i++;
      }
      const entries = pairToolMessages(toolMsgs);
      if (entries.length > 0) {
        for (const entry of entries) {
          const meta = entry.call.metadata as Record<string, unknown> | null;
          if (typeof meta?.parent_tool_call_id === "string") continue;
          items.push({ kind: "tool_entry", entry, key: `e-${entry.call.id}` });
        }
      }
    } else {
      items.push({ kind: "single", message: msgs[i], msgIndex: i, key: `s-${msgs[i].id}` });
      i++;
    }
  }
  return items;
});

type ToolEntryItem    = Extract<DisplayItem, { kind: "tool_entry" }>;
type CodeReviewItem   = Extract<DisplayItem, { kind: "code_review" }>;
type SingleItem       = Extract<DisplayItem, { kind: "single" }>;

function asToolEntry(i: number)  { return displayItems.value[i] as ToolEntryItem; }
function asCodeReview(i: number) { return displayItems.value[i] as CodeReviewItem; }
function asSingle(i: number)     { return displayItems.value[i] as SingleItem; }

// True if there is any live content in the stream state (suppresses the "Thinking..." spinner)
const hasLiveContent = computed(() => {
  const state = taskStore.activeStreamState;
  if (!state || state.isDone) return false;
  return state.roots.length > 0 || !!state.statusMessage;
});

// ─── Resizable drawer ────────────────────────────────────────────────────────
const drawerWidth = ref(Math.round(window.innerWidth * 0.7));
const MIN_WIDTH = 480;
const MAX_WIDTH = 1400;

function onHide() {
  drawerWidth.value = Math.round(window.innerWidth * 0.7);
  activeTab.value = 'chat';
  taskStore.closeTask();
}

// ─── Outside-click guard ─────────────────────────────────────────────────────
// PrimeVue teleports overlays (Select panels, Dialog backdrops) to document.body,
// outside the Drawer subtree. We disable PrimeVue's built-in dismissable and
// implement a smarter guard that ignores those overlay clicks.
// PrimeVue teleports overlay panels (Select, MultiSelect, etc.) to document.body
// with the class 'p-select-overlay'. We must skip closing when a click lands inside one.

function handleOutsideClick(e: MouseEvent) {
  if (!open.value) return;
  // Skip if the click is inside any PrimeVue overlay panel teleported to body
  const target = e.target as Element | null;
  if (target?.closest('.p-select-overlay, .p-dialog, .p-datepicker, .p-autocomplete-overlay, .p-multiselect-overlay, .todo-overlay-backdrop, .task-overlay')) return;
  // Skip if our own dialogs are open
  if (deleteDialogVisible.value) return;
  // PrimeVue Drawer teleports its panel to document.body, so $el is a comment
  // node — not the visible panel. Query the rendered panel by its CSS class instead.
  const drawerPanel = document.querySelector('.p-drawer');
  if (drawerPanel && drawerPanel.contains(e.target as Node)) return;
  // True outside click — close
  taskStore.closeTask();
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
  // Load MCP server status
  api("mcp.getStatus", {}).then(s => { mcpStatus.value = s; }).catch(() => { /* MCP may not be configured */ });
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleOutsideClick);
});

function startResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = drawerWidth.value;

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    drawerWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
  }
  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function renderMd(content: string): string {
  return marked.parse(content, { async: false, breaks: true, gfm: true }) as string;
}

const open = computed({
  get: () => taskStore.activeTaskId !== null,
  set: (v) => { if (!v) taskStore.closeTask(); },
});

const task = computed(() => taskStore.activeTask);
const taskWorkspaceKey = computed(() =>
  task.value ? (boardStore.boards.find((b) => b.id === task.value!.boardId)?.workspaceKey ?? undefined) : undefined,
);
const inputText = ref("");
const pendingAttachments = ref<Attachment[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const transitioning = ref(false);
const retrying = ref(false);
const cancelling = ref(false);
const scrollEl = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(computed(() => ({
  count: displayItems.value.length,
  getScrollElement: () => scrollEl.value,
  // Stable string keys so measurements survive list updates (new messages, task
  // switch doesn't matter since we call measure() on task switch).
  getItemKey: (index) => displayItems.value[index]?.key ?? index,
  // Per-kind estimates: MessageBubbles are short (~80px), ToolCallGroups with
  // output or children can be 600–2000px. Accurate estimates minimise the
  // position-correction jump when a new item first enters the viewport.
  estimateSize: (index) => {
    const item = displayItems.value[index];
    if (!item) return 80;
    if (item.kind === 'single') return 80;
    if (item.kind === 'code_review') return 300;
    // tool_entry: always starts collapsed (open=false), so the real rendered
    // height is just the header button: padding 7px*2 + ~1rem icon ≈ 36px.
    // Using the actual collapsed height minimises the position-correction jump
    // that was previously causing items to appear to "blink" on scroll.
    return 36;
  },
  overscan: 15,
})));

// Stable ref callback — using an inline arrow in :ref creates a new function
// every render. A stable function is only called on actual mount/unmount.
//
// TanStack's own measureElement defers resizeItem during user scroll
// (isScrolling=true) and relies on ResizeObserver to fire later. That
// async gap causes items to remain hidden for an extra rendering pass,
// which appears as a "pop-in" stutter. We bypass the guard by calling
// resizeItem directly with the live offsetHeight, then still register
// with TanStack's internal ResizeObserver for ongoing size changes (e.g.
// ToolCallGroup expand/collapse).
function measureRef(el: Element | null) {
  if (!el) return;
  const index = parseInt((el as HTMLElement).dataset.index ?? '-1');
  if (index >= 0) {
    virtualizer.value.resizeItem(index, (el as HTMLElement).offsetHeight);
  }
  // Also register with ResizeObserver so expansions are tracked.
  virtualizer.value.measureElement(el);
}

// When true, every totalSize change will re-pin scroll to the bottom.
// Set on task open; cleared once measurements stabilize.
const pendingScrollBottom = ref(false);
watch(
  () => virtualizer.value.getTotalSize(),
  () => { if (pendingScrollBottom.value) scrollToBottom(); },
);
const contextWarning = ref<string | null>(null);
const compacting = ref(false);

// Incremented whenever the model completes a turn, to trigger a todo refresh.
const todoRefreshTrigger = ref(0);

// Git numstat (fetched on drawer open when worktree is ready)
const numstat = ref<GitNumstat | null>(null);

// Pending hunks per file (awaiting human review)
const pendingByFile = ref<{ filePath: string; pendingCount: number }[]>([]);


// Task overlay state
const taskOverlayVisible = ref(false);

// Delete dialog state
const deleteDialogVisible = ref(false);
const deleteLoading = ref(false);
const deleteError = ref<string | null>(null);
const deleteWarning = ref<string | null>(null);

// Columns from the active board template
const columns = computed(() => {
  return boardStore.activeBoard?.template.columns ?? [];
});

// ─── Smart auto-scroll ───────────────────────────────────────────────────────
// Auto-scroll is active by default. It pauses when the user scrolls up and
// resumes automatically once they scroll back within 60px of the bottom.
const SCROLL_THRESHOLD = 60; // px from bottom considered "at bottom"
const autoScroll = ref(true);

function onScroll() {
  if (!scrollEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollEl.value;
  const distFromBottom = scrollHeight - scrollTop - clientHeight;
  autoScroll.value = distFromBottom < SCROLL_THRESHOLD;
}

function scrollToBottom(behavior: ScrollBehavior = "instant") {
  if (!scrollEl.value) return;
  scrollEl.value.scrollTo({ top: scrollEl.value.scrollHeight, behavior });
}

// Auto-scroll to bottom when messages or live stream changes
watch(
  [
    () => taskStore.messages.length,
    () => taskStore.streamingToken.length,
    () => taskStore.streamingReasoningToken.length,
    () => taskStore.streamingStatusMessage.length,
    () => task.value?.executionState,
    () => taskStore.streamVersion,
  ],
  async ([newMsgLen, , , , , newStreamVersion], [oldMsgLen, , , , , oldStreamVersion]) => {
    await nextTick();
    if (!autoScroll.value) return;
    // Smooth scroll only when a whole new message arrives; instant during streaming chunks
    const isNewMessage = newMsgLen !== oldMsgLen;
    scrollToBottom(isNewMessage ? "smooth" : "instant");
  },
);

// Always scroll to bottom when a new task is opened; also reset virtualizer
// measurements so stale sizes from the previous task don't affect the new one.
watch(
  () => taskStore.activeTaskId,
  async () => {
    autoScroll.value = true;
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
    virtualizer.value.measure();
    pendingScrollBottom.value = true;
    await nextTick();
    scrollToBottom();
    setTimeout(() => { pendingScrollBottom.value = false; }, 500);
  },
);

const execLabel = computed(() => {
  const map: Record<string, string> = {
    idle: "Idle",
    running: "Running…",
    waiting_user: "Awaiting input",
    waiting_external: "Waiting",
    failed: "Failed",
    completed: "Done",
    cancelled: "Cancelled",
  };
  return task.value ? (map[task.value.executionState] ?? task.value.executionState) : "";
});

const execSeverity = computed(() => {
  const map: Record<string, "secondary" | "info" | "warn" | "danger" | "success"> = {
    idle: "secondary",
    running: "info",
    waiting_user: "warn",
    waiting_external: "warn",
    failed: "danger",
    completed: "success",
    cancelled: "secondary",
  };
  return task.value ? (map[task.value.executionState] ?? "secondary") : "secondary";
});

function readAsBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix: "data:image/png;base64,XXXX" → "XXXX"
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function inferMediaType(filename: string, reportedType: string): string {
  if (reportedType && reportedType !== "application/octet-stream") return reportedType;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json",
    js: "text/javascript", ts: "text/typescript", py: "text/x-python",
    html: "text/html", css: "text/css", csv: "text/csv",
    xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
    sh: "text/x-shellscript", pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp",
  };
  return map[ext] ?? reportedType ?? "application/octet-stream";
}

async function addAttachment(file: File | Blob, label: string, mediaType: string) {
  if (pendingAttachments.value.length >= 3) {
    toast.add({ severity: "warn", summary: "Too many attachments", detail: "Maximum 3 attachments per message", life: 4000 });
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.add({ severity: "warn", summary: "File too large", detail: "Attachments must be under 5 MB", life: 4000 });
    return;
  }
  const data = await readAsBase64(file);
  pendingAttachments.value.push({ label, mediaType, data });
}

async function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file") {
      event.preventDefault();
      const blob = item.getAsFile();
      if (blob) {
        const inferredType = inferMediaType(`pasted-file`, item.type || "");
        const ext = inferredType.split("/")[1] ?? "bin";
        await addAttachment(blob, `pasted-file.${ext}`, inferredType);
      }
      break;
    }
  }
}

async function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  for (const file of files) {
    await addAttachment(file, file.name, inferMediaType(file.name, file.type));
  }
  // Reset so the same file can be selected again
  input.value = "";
}

async function send() {
  if (!inputText.value.trim() || !task.value) return;
  const content = inputText.value.trim();
  inputText.value = "";
  const attachments = pendingAttachments.value.length ? [...pendingAttachments.value] : undefined;
  pendingAttachments.value = [];
  await taskStore.sendMessage(task.value.id, content, attachments);
}

async function transition(toState: string) {
  if (!task.value) return;
  transitioning.value = true;
  try {
    await taskStore.transitionTask(task.value.id, toState);
  } finally {
    transitioning.value = false;
  }
}

async function retry() {
  if (!task.value) return;
  retrying.value = true;
  try {
    await taskStore.retryTask(task.value.id);
  } finally {
    retrying.value = false;
  }
}

async function cancel() {
  if (!task.value) return;
  cancelling.value = true;
  try {
    await taskStore.cancelTask(task.value.id);
  } finally {
    cancelling.value = false;
  }
}

async function onModelChange(model: string | null) {
  if (!task.value) return;
  await taskStore.setModel(task.value.id, model);
}

async function toggleShellAutoApprove() {
  if (!task.value) return;
  const newValue = !task.value.shellAutoApprove;
  await api("tasks.setShellAutoApprove", { taskId: task.value.id, enabled: newValue });
}

async function compactConversation() {
  if (!task.value) return;
  compacting.value = true;
  try {
    await taskStore.compactTask(task.value.id);
  } catch (err) {
    toast.add({ severity: "error", summary: "Compact failed", detail: err instanceof Error ? err.message : String(err), life: 6000 });
  } finally {
    compacting.value = false;
  }
}

async function openTerminal() {
  if (!task.value?.worktreePath) return;
  const cwd = task.value.worktreePath;
  const result = await api("launch.shell", { cwd });
  terminalStore.addSession(result.sessionId, task.value.title, cwd);
}

function openTaskOverlay() {
  if (!task.value) return;
  taskOverlayVisible.value = true;
}

function confirmDelete() {
  deleteError.value = null;
  deleteWarning.value = null;
  deleteDialogVisible.value = true;
}

async function deleteTask() {
  if (!task.value) return;
  deleteLoading.value = true;
  deleteError.value = null;
  deleteWarning.value = null;
  try {
    const { warning } = await taskStore.deleteTask(task.value.id);
    if (warning) {
      deleteWarning.value = warning;
      // Task is deleted — close after a short delay so the user can read the warning
      setTimeout(() => { deleteDialogVisible.value = false; }, 4000);
    } else {
      deleteDialogVisible.value = false;
    }
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : 'Failed to delete task';
  } finally {
    deleteLoading.value = false;
  }
}

// Fetch git stat and models when drawer opens / task changes
watch(
  () => taskStore.activeTaskId,
  async (id) => {
    numstat.value = null;
    pendingByFile.value = [];
    launchConfig.value = null;
    if (!id) return;
    taskStore.loadEnabledModels(taskWorkspaceKey.value);
    const t = taskStore.activeTask;
    if (t?.worktreeStatus === "ready") {
      numstat.value = await taskStore.getGitStat(id);
      taskStore.refreshChangedFiles(id);
      try {
        pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: id });
      } catch { /* non-fatal */ }
    }
    // Load launch config (deduped in store by projectKey)
    if (t) {
      launchConfig.value = await launchStore.getConfig(id, t.projectKey);
    }
  },
  { immediate: true },
);

// Refresh todos when the model finishes a turn (executionState leaves 'running').
watch(
  () => task.value?.executionState,
  async (state, prev) => {
    if (prev === "running" && state !== "running") {
      todoRefreshTrigger.value++;
      // Refresh changed files + pending hunks after model turn completes
      if (task.value) {
        numstat.value = await taskStore.getGitStat(task.value.id);
        try {
          pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
        } catch { /* non-fatal */ }
      }
    }
  },
);

function onTaskSaved() {
  if (!task.value) return;
  taskOverlayVisible.value = false;
  taskStore.loadTasks(task.value.boardId);
}

function onTaskDeleted() {
  if (!task.value) return;
  taskOverlayVisible.value = false;
  taskStore.closeTask();
}
</script>

<style scoped>
.drawer-resize-handle {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1001; /* above the drawer overlay */
  background: transparent;
  transition: background 0.15s;
}

.drawer-resize-handle:hover,
.drawer-resize-handle:active {
  background: var(--p-primary-color, #6366f1);
  opacity: 0.35;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.drawer-header__title {
  font-weight: 600;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.drawer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.tab-switcher {
  display: flex;
  gap: 2px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 0.82rem;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--p-text-muted-color, #94a3b8);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.tab-btn:hover {
  background: var(--p-content-hover-background, #f1f5f9);
  color: var(--p-text-color, #1e293b);
}

.tab-btn--active {
  background: var(--p-content-hover-background, #f1f5f9);
  color: var(--p-primary-color, #6366f1);
  font-weight: 600;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.workflow-select {
  min-width: 120px;
  max-width: 160px;
}

.task-tab-chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.task-tab-info {
  flex: 1;
  overflow-y: auto;
}

.task-detail__conversation {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 8px 0;
  will-change: scroll-position;
  overflow-anchor: none;
}

.conversation-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-detail__input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.task-detail__input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.task-detail__input-row .flex-1 {
  flex: 1;
  resize: none;
}

.task-detail__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px 2px 8px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--p-surface-100, #f3f4f6);
  border: 1px solid var(--p-surface-300, #d1d5db);
  border-radius: 12px;
  font-size: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip__remove {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  color: var(--p-text-muted-color, #6b7280);
  flex-shrink: 0;
}

.attachment-chip__remove:hover {
  color: var(--p-text-color, #374151);
}

.task-detail__model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.shell-autoapprove-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
}

.shell-autoapprove-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.task-detail__mcp-btn {
  flex-shrink: 0;
}

.input-model-select {
  min-width: 180px;
}

.model-select__value {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-select__option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.model-select__option-title {
  font-weight: 600;
}

.model-select__option-description {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  white-space: normal;
}

.model-select__option-id {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
  font-family: ui-monospace, "Cascadia Code", monospace;
}

.model-empty-state {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-empty-label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.model-select-footer {
  padding: 4px 8px;
  border-top: 1px solid var(--p-content-border-color);
}

.context-ring {
  flex-shrink: 0;
  cursor: default;
}

.context-ring__track {
  stroke: var(--p-surface-200, #e2e8f0);
}

.context-ring__label {
  fill: var(--p-text-color, #1e293b);
  font-family: system-ui, sans-serif;
}

.context-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--p-orange-600, #e07010);
  background: var(--p-orange-50, #fff7ed);
  border: 1px solid var(--p-orange-200, #fed7aa);
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 4px;
}

/* Streaming cursor animation */
.cursor {
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.msg {
  display: flex;
  flex-direction: column;
}

.msg--assistant {
  align-items: flex-start;
}

.msg--assistant .msg__bubble {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px 12px 12px 2px;
  padding: 10px 14px;
  max-width: 85%;
  word-break: break-word;
}

/* Prose styles for the live streaming bubble (v-html rendered markdown) */
.msg--assistant .msg__bubble :deep(p) { margin: 0 0 0.6em; line-height: 1.6; }
.msg--assistant .msg__bubble :deep(p:last-child) { margin-bottom: 0; }
.msg--assistant .msg__bubble :deep(h1),.msg--assistant .msg__bubble :deep(h2),
.msg--assistant .msg__bubble :deep(h3),.msg--assistant .msg__bubble :deep(h4) {
  font-weight: 600; margin: 0.8em 0 0.3em; line-height: 1.3;
}
.msg--assistant .msg__bubble :deep(ul),.msg--assistant .msg__bubble :deep(ol) {
  margin: 0.4em 0 0.6em 1.4em; padding: 0;
}
.msg--assistant .msg__bubble :deep(li) { margin: 0.15em 0; line-height: 1.5; }
.msg--assistant .msg__bubble :deep(code) {
  font-family: ui-monospace, monospace; font-size: 0.82em;
  background: var(--p-content-hover-background); border-radius: 4px; padding: 1px 5px;
}
.msg--assistant .msg__bubble :deep(pre) {
  background: var(--p-surface-900, #0f172a); color: var(--p-surface-100, #f1f5f9);
  border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0.6em 0;
  font-size: 0.8rem; line-height: 1.5;
}
.msg--assistant .msg__bubble :deep(pre code) { background: none; padding: 0; color: inherit; }

.msg__meta {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-top: 2px;
  padding: 0 4px;
}

.msg--system {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
  padding: 4px 0;
}

.delete-warn {
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-top: 6px;
}

.dialog-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--p-red-600, #dc2626);
  background: var(--p-red-50, #fef2f2);
  border: 1px solid var(--p-red-200, #fecaca);
  border-radius: 6px;
  padding: 8px 12px;
  margin-top: 10px;
}

.dialog-warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--p-orange-700, #c2410c);
  background: var(--p-orange-50, #fff7ed);
  border: 1px solid var(--p-orange-200, #fed7aa);
  border-radius: 6px;
  padding: 8px 12px;
  margin-top: 10px;
}
</style>

<style>
html.dark-mode .dialog-warning {
  color: var(--p-orange-400);
  background: color-mix(in srgb, var(--p-orange-500) 15%, transparent);
  border-color: color-mix(in srgb, var(--p-orange-500) 35%, transparent);
}
html.dark-mode .task-detail__input {
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .attachment-chip {
  background: var(--p-surface-800, #1f2937);
  border-color: var(--p-surface-600, #4b5563);
}
html.dark-mode .context-ring__track {
  stroke: var(--p-surface-700, #334155);
}
html.dark-mode .context-ring__label {
  fill: var(--p-text-color, #e2e8f0);
}
</style>
