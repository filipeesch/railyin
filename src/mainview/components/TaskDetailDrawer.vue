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
        <!-- Changed files badge -->
        <span
          v-if="changedCount > 0"
          class="drawer-header__changed-badge"
          :title="`${changedCount} file${changedCount !== 1 ? 's' : ''} changed — click to review`"
          @click="openReviewOverlay"
        >&#x2B21; {{ changedCount }}</span>
        <Button
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          v-tooltip="'Sync changed files'"
          :loading="syncingChanges"
          @click="syncChangedFiles"
        />
        <!-- Edit button: visible only when worktree not yet created -->
        <Button
          v-if="!task.worktreeStatus || task.worktreeStatus === 'not_created'"
          icon="pi pi-pencil"
          text
          rounded
          size="small"
          class="ml-auto"
          v-tooltip="'Edit title & description'"
          @click="openEditDialog"
        />
        <Button
          v-else
          icon="pi pi-pencil"
          text
          rounded
          size="small"
          class="ml-auto"
          disabled
          v-tooltip="'Cannot edit after worktree is created'"
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
      <!-- Two-column layout: conversation + side panel -->
      <div class="task-detail__body">

        <!-- Conversation timeline -->
        <div class="task-detail__conversation" ref="scrollEl" @scroll.passive="onScroll">
          <div class="conversation-inner">
            <template v-for="item in displayItems" :key="item.key">
              <ToolCallGroup
                v-if="item.kind === 'tool_entry'"
                :entry="item.entry"
              />
              <CodeReviewCard
                v-else-if="item.kind === 'code_review'"
                :message="item.message"
              />
              <MessageBubble
                v-else
                :chunk="item.message"
                :index="item.msgIndex"
              />
            </template>

            <!-- Live streaming reasoning bubble (task 6.2) -->
            <ReasoningBubble
              v-if="taskStore.streamingReasoningToken && taskStore.streamingTaskId === task.id"
              :content="taskStore.streamingReasoningToken"
              :streaming="taskStore.isStreamingReasoning"
              key="live-reasoning"
            />

            <!-- Live streaming bubble (only when this task is the one streaming) -->
            <div
              v-if="taskStore.streamingToken && taskStore.streamingTaskId === task.id"
              class="msg msg--assistant"
            >
              <div class="msg__bubble prose streaming" v-html="renderMd(taskStore.streamingToken)" />
              <div class="msg__meta">AI<span class="cursor">▌</span></div>
            </div>

            <!-- Ephemeral status message during non-streaming fallback (cleared when tokens arrive) -->
            <div
              v-else-if="taskStore.streamingStatusMessage && taskStore.streamingTaskId === task.id"
              class="msg msg--system msg--status-ephemeral"
            >
              <ProgressSpinner style="width: 16px; height: 16px" />
              <span>{{ taskStore.streamingStatusMessage }}</span>
            </div>

            <!-- Running spinner when no tokens yet -->
            <div
              v-else-if="task.executionState === 'running'"
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

        <!-- Side panel (9.6) -->
        <div class="task-detail__side">
          <div class="side-section">
            <div class="side-label">Workflow state</div>
            <div class="side-value">{{ task.workflowState }}</div>
          </div>
          <div class="side-section">
            <div class="side-label">Execution</div>
            <div class="side-value">{{ execLabel }}</div>
          </div>
          <div class="side-section" v-if="task.retryCount > 0">
            <div class="side-label">Retries</div>
            <div class="side-value">{{ task.retryCount }}</div>
          </div>
          <div class="side-section" v-if="task.executionCount > 0">
            <div class="side-label">Executions</div>
            <div class="side-value">{{ task.executionCount }}</div>
          </div>

          <!-- Branch / worktree info -->
          <div class="side-section" v-if="task.branchName">
            <div class="side-label">Branch</div>
            <div class="side-value side-value--mono">{{ task.branchName }}</div>
          </div>
          <div class="side-section" v-if="task.worktreeStatus">
            <div class="side-label">Worktree</div>
            <div class="side-value">{{ task.worktreeStatus }}</div>
          </div>
          <div class="side-section" v-if="task.worktreePath">
            <div class="side-label">Worktree path</div>
            <div class="side-value side-value--mono side-value--break">{{ task.worktreePath }}</div>
          </div>

          <!-- Git diff stat -->
          <div class="side-section" v-if="gitStat">
            <div class="side-label">Changes</div>
            <pre class="side-git-stat">{{ gitStat }}</pre>
          </div>

          <!-- Session notes -->
          <div class="side-section" v-if="sessionMemoryContent">
            <div class="side-label">Session Notes</div>
            <pre class="side-session-notes">{{ sessionMemoryContent }}</pre>
          </div>

          <!-- Transition buttons -->
          <div class="side-section" v-if="columns.length">
            <div class="side-label">Move to</div>
            <div class="side-transitions">
              <Button
                v-for="col in otherColumns"
                :key="col.id"
                :label="col.label"
                size="small"
                severity="secondary"
                :disabled="transitioning"
                @click="transition(col.id)"
              />
            </div>
          </div>

          <!-- Retry button -->
          <div
            class="side-section"
            v-if="task.executionState === 'failed'"
          >
            <Button
              label="Retry"
              icon="pi pi-replay"
              severity="warn"
              :loading="retrying"
              @click="retry"
            />
          </div>
        </div>
      </div>

      <!-- Chat input (9.4) -->
      <TodoPanel
        v-if="task"
        :task-id="task.id"
        :refresh-trigger="todoRefreshTrigger"
      />
      <div class="task-detail__input">
        <div class="task-detail__input-row">
          <Textarea
            v-model="inputText"
            placeholder="Send a message… (Shift+Enter for newline)"
            class="flex-1"
            rows="1"
            autoResize
            :disabled="task.executionState === 'running' || compacting"
            @keydown.enter.exact.prevent="send"
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
              option-label="id"
              option-value="id"
              filter
              filter-placeholder="Search models…"
              size="small"
              class="input-model-select"
              @change="(e: { value: string }) => onModelChange(e.value)"
            >
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
          <!-- Context gauge -->
          <div
            v-if="taskStore.contextUsage"
            class="context-gauge"
            :title="`~${taskStore.contextUsage.usedTokens.toLocaleString()} / ${taskStore.contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(taskStore.contextUsage.fraction * 100)}%)`"
          >
            <div
              class="context-gauge__bar"
              :class="{
                'context-gauge__bar--warn': taskStore.contextUsage.fraction >= 0.70 && taskStore.contextUsage.fraction < 0.90,
                'context-gauge__bar--danger': taskStore.contextUsage.fraction >= 0.90,
              }"
              :style="{ width: `${Math.round(taskStore.contextUsage.fraction * 100)}%` }"
            />
          </div>
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
        </div>
      </div>
    </div>
  </Drawer>

  <!-- Manage models modal -->
  <ManageModelsModal
    v-model="manageModelsOpen"
    @close="onManageModelsClosed"
  />

  <!-- Edit task dialog -->
  <Dialog v-model:visible="editDialogVisible" header="Edit task" :modal="true" :style="{ width: '480px' }">
    <div class="edit-form">
      <label class="edit-label">Title</label>
      <InputText v-model="editTitle" class="w-full" />
      <label class="edit-label mt-2">Description</label>
      <Textarea v-model="editDescription" rows="5" class="w-full" autoResize />
    </div>
    <div v-if="saveError" class="dialog-error">
      <i class="pi pi-exclamation-circle" />
      {{ saveError }}
    </div>
    <template #footer>
      <Button label="Cancel" text @click="editDialogVisible = false; saveError = null" />
      <Button label="Save" :loading="editSaving" :disabled="!editTitle.trim()" @click="saveEdit" />
    </template>
  </Dialog>

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
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { marked } from "marked";
import Drawer from "primevue/drawer";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import ProgressSpinner from "primevue/progressspinner";
import ToggleSwitch from "primevue/toggleswitch";
import MessageBubble from "./MessageBubble.vue";
import ToolCallGroup, { type ToolEntry } from "./ToolCallGroup.vue";
import ReasoningBubble from "./ReasoningBubble.vue";
import CodeReviewCard from "./CodeReviewCard.vue";
import ManageModelsModal from "./ManageModelsModal.vue";
import TodoPanel from "./TodoPanel.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";
import { useToast } from "primevue/usetoast";
import { useReviewStore } from "../stores/review";
import { electroview } from "../rpc";
import type { ConversationMessage, ExecutionState } from "@shared/rpc-types";

const taskStore = useTaskStore();
const boardStore = useBoardStore();
const toast = useToast();
const reviewStore = useReviewStore();

const manageModelsOpen = ref(false);

async function onManageModelsClosed() {
  await taskStore.loadEnabledModels();
}

const groupedModels = computed(() => {
  const groups: Record<string, Array<{ id: string; contextWindow: number | null }>> = {};
  for (const model of taskStore.availableModels) {
    const slash = model.id.indexOf("/");
    const provider = slash !== -1 ? model.id.slice(0, slash) : "other";
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(model);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
});

const changedCount = computed(() => task.value ? (taskStore.changedFileCounts[task.value.id] ?? 0) : 0);
const syncingChanges = ref(false);

async function openReviewOverlay() {
  if (!task.value) return;
  const files = await electroview.rpc!.request["tasks.getChangedFiles"]({ taskId: task.value.id });
  reviewStore.openReview(task.value.id, files);
}

async function syncChangedFiles() {
  if (!task.value) return;
  syncingChanges.value = true;
  try {
    await taskStore.refreshChangedFiles(task.value.id);
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

function pairToolMessages(msgs: ConversationMessage[]): ToolEntry[] {
  const entries: ToolEntry[] = [];
  let i = 0;
  while (i < msgs.length) {
    if (msgs[i].type === "tool_call") {
      const entry: ToolEntry = { call: msgs[i], result: null, diff: null };
      i++;
      if (i < msgs.length && msgs[i].type === "tool_result")  { entry.result = msgs[i]; i++; }
      if (i < msgs.length && msgs[i].type === "file_diff")    { entry.diff   = msgs[i]; i++; }
      entries.push(entry);
    } else {
      i++; // skip orphaned result/diff
    }
  }
  return entries;
}

const displayItems = computed<DisplayItem[]>(() => {
  const msgs = taskStore.messages;
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < msgs.length) {
    if (msgs[i].type === "code_review") {
      items.push({ kind: "code_review", message: msgs[i], key: `cr-${msgs[i].id}` });
      i++;
    } else if (TOOL_MSG_TYPES.has(msgs[i].type)) {
      const toolMsgs: ConversationMessage[] = [];
      while (i < msgs.length && TOOL_MSG_TYPES.has(msgs[i].type)) {
        toolMsgs.push(msgs[i]);
        i++;
      }
      const entries = pairToolMessages(toolMsgs);
      if (entries.length > 0) {
        for (const entry of entries) {
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

// ─── Resizable drawer ────────────────────────────────────────────────────────
const drawerWidth = ref(Math.round(window.innerWidth * 0.7));
const MIN_WIDTH = 480;
const MAX_WIDTH = 1400;

function onHide() {
  drawerWidth.value = Math.round(window.innerWidth * 0.7);
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
  if (target?.closest('.p-select-overlay, .p-dialog, .p-datepicker, .p-autocomplete-overlay, .p-multiselect-overlay')) return;
  // Skip if our own dialogs are open
  if (editDialogVisible.value || deleteDialogVisible.value) return;
  // PrimeVue Drawer teleports its panel to document.body, so $el is a comment
  // node — not the visible panel. Query the rendered panel by its CSS class instead.
  const drawerPanel = document.querySelector('.p-drawer');
  if (drawerPanel && drawerPanel.contains(e.target as Node)) return;
  // True outside click — close
  taskStore.closeTask();
}

onMounted(() => {
  document.addEventListener('mousedown', handleOutsideClick);
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
  return marked.parse(content, { async: false }) as string;
}

const open = computed({
  get: () => taskStore.activeTaskId !== null,
  set: (v) => { if (!v) taskStore.closeTask(); },
});

const task = computed(() => taskStore.activeTask);
const inputText = ref("");
const transitioning = ref(false);
const retrying = ref(false);
const cancelling = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
const contextWarning = ref<string | null>(null);
const compacting = ref(false);

// Incremented whenever the model completes a turn, to trigger a todo refresh.
const todoRefreshTrigger = ref(0);

// Git diff stat (fetched on drawer open when worktree is ready)
const gitStat = ref<string | null>(null);

// Session memory notes (fetched on drawer open)
const sessionMemoryContent = ref<string | null>(null);

// Edit dialog state
const editDialogVisible = ref(false);
const editTitle = ref("");
const editDescription = ref("");
const editSaving = ref(false);

// Delete dialog state
const deleteDialogVisible = ref(false);
const deleteLoading = ref(false);
const deleteError = ref<string | null>(null);
const deleteWarning = ref<string | null>(null);

// Edit error state
const saveError = ref<string | null>(null);

// Columns from the active board template
const columns = computed(() => {
  return boardStore.activeBoard?.template.columns ?? [];
});

const otherColumns = computed(() => {
  if (!task.value) return columns.value;
  return columns.value.filter((c) => c.id !== task.value!.workflowState);
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

function scrollToBottom() {
  if (!scrollEl.value) return;
  scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

// Auto-scroll to bottom when messages change
watch(
  [() => taskStore.messages.length, () => taskStore.streamingToken],
  async () => {
    await nextTick();
    if (autoScroll.value) scrollToBottom();
  },
);

// Always scroll to bottom when a new task is opened
watch(
  () => taskStore.activeTaskId,
  async () => {
    autoScroll.value = true;
    await nextTick();
    scrollToBottom();
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

async function send() {
  if (!inputText.value.trim() || !task.value) return;
  const content = inputText.value.trim();
  inputText.value = "";
  await taskStore.sendMessage(task.value.id, content);
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

async function onModelChange(model: string) {
  if (!task.value) return;
  await taskStore.setModel(task.value.id, model);
}

async function toggleShellAutoApprove() {
  if (!task.value) return;
  const newValue = !task.value.shellAutoApprove;
  await electroview.rpc!.request["tasks.setShellAutoApprove"]({ taskId: task.value.id, enabled: newValue });
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

function openEditDialog() {
  if (!task.value) return;
  editTitle.value = task.value.title;
  editDescription.value = task.value.description;
  editDialogVisible.value = true;
}

async function saveEdit() {
  if (!task.value || !editTitle.value.trim()) return;
  editSaving.value = true;
  saveError.value = null;
  try {
    await taskStore.updateTask(task.value.id, editTitle.value.trim(), editDescription.value.trim());
    editDialogVisible.value = false;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to save changes';
  } finally {
    editSaving.value = false;
  }
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
    gitStat.value = null;
    sessionMemoryContent.value = null;
    if (!id) return;
    taskStore.loadEnabledModels();
    const t = taskStore.activeTask;
    if (t?.worktreeStatus === "ready") {
      gitStat.value = await taskStore.getGitStat(id);
      taskStore.refreshChangedFiles(id);
    }
    try {
      const { content } = await electroview.rpc!.request["tasks.sessionMemory"]({ taskId: id });
      sessionMemoryContent.value = content;
    } catch { /* non-fatal */ }
  },
  { immediate: true },
);

// Refresh todos when the model finishes a turn (executionState leaves 'running').
watch(
  () => task.value?.executionState,
  (state, prev) => {
    if (prev === "running" && state !== "running") {
      todoRefreshTrigger.value++;
    }
  },
);
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

.drawer-header__changed-badge {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-primary-color, #6366f1);
  background: var(--p-primary-50, #eef2ff);
  border: 1px solid var(--p-primary-200, #c7d2fe);
  border-radius: 10px;
  padding: 1px 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
  margin-left: 6px;
}

.drawer-header__changed-badge:hover {
  background: var(--p-primary-100, #e0e7ff);
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

.task-detail__body {
  display: flex;
  flex: 1;
  gap: 16px;
  overflow: hidden;
}

.task-detail__conversation {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 8px 0;
}

.conversation-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-detail__side {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
  border-left: 1px solid var(--p-surface-200, #e2e8f0);
  padding-left: 16px;
}

.side-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.side-value {
  font-size: 0.85rem;
  color: var(--p-text-color, #1e293b);
}

.side-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.side-transitions {
  display: flex;
  flex-direction: column;
  gap: 4px;
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

.input-model-select {
  min-width: 180px;
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

.context-gauge {
  flex: 1;
  max-width: 80px;
  height: 6px;
  background: var(--p-surface-200, #e2e8f0);
  border-radius: 3px;
  overflow: hidden;
  cursor: default;
}

.context-gauge__bar {
  height: 100%;
  border-radius: 3px;
  background: var(--p-green-500, #22c55e);
  transition: width 0.3s ease;
}

.context-gauge__bar--warn {
  background: var(--p-yellow-500, #eab308);
}

.context-gauge__bar--danger {
  background: var(--p-red-500, #ef4444);
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
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-200, #e2e8f0);
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
  background: var(--p-surface-100, #f1f5f9); border-radius: 4px; padding: 1px 5px;
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

.side-value--mono {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.side-value--break {
  word-break: break-all;
}

.side-git-stat {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  white-space: pre-wrap;
  margin: 0;
  color: var(--p-text-color, #1e293b);
  background: var(--p-surface-100, #f1f5f9);
  border-radius: 4px;
  padding: 6px 8px;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.edit-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #94a3b8);
}

.mt-2 {
  margin-top: 8px;
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
