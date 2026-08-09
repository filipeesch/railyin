<template>
  <div class="task-chat-view task-detail">
    <!-- Header row -->
    <div class="tcv-header">
      <div class="tcv-header__left">
        <span class="tcv-header__title" :title="task?.title">{{ task?.title ?? '' }}</span>
        <Tag
          v-if="task"
          :value="execLabel"
          :severity="execSeverity"
          rounded
          class="ml-2"
        />
      </div>
      <div class="tcv-header__actions">
        <Button
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          v-tooltip="'Sync changed files'"
          :loading="syncingChanges"
          @click="syncChangedFiles"
        />
        <Button
          icon="pi pi-trash"
          text
          rounded
          size="small"
          severity="danger"
          v-tooltip="'Delete task'"
          @click="deleteDialogVisible = true"
        />
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          severity="secondary"
          v-tooltip="'Close'"
          @click="drawerStore.close()"
        />
      </div>
    </div>

    <!-- Toolbar: tabs + workflow state + terminal/retry/launch -->
    <div class="tcv-toolbar">
      <div class="tab-switcher">
        <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'chat' }]" @click="activeTab = 'chat'">
          <i class="pi pi-comments" /> Chat
        </button>
        <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'info' }]" @click="activeTab = 'info'">
          <i class="pi pi-info-circle" /> Info
        </button>
        <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'git' }]" @click="activeTab = 'git'">
          <Icon icon="mdi:source-branch" width="14" height="14" /> Git
        </button>
        <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'decisions' }]" @click="activeTab = 'decisions'">
          <i class="pi pi-list-check" /> Decisions
        </button>
        <button :class="['tab-btn', { 'tab-btn--active': activeTab === 'notes' }]" @click="activeTab = 'notes'">
          <i class="pi pi-file-edit" /> Notes
        </button>
      </div>
      <div class="toolbar-actions" v-if="task">
        <Select
          v-if="selectableColumns.length"
          :model-value="task.workflowState"
          :options="selectableColumns"
          option-label="label"
          option-value="id"
          option-disabled="disabled"
          size="small"
          class="workflow-select"
          :disabled="transitioning"
          @change="(e: { value: string }) => transition(e.value)"
        >
          <template #value>
            {{ selectableColumns.find(c => c.id === task.workflowState)?.label ?? task.workflowState }}
          </template>
        </Select>
        <Button
          v-if="task.worktreePath"
          icon="pi pi-code"
          class="task-detail__code-btn"
          text
          size="small"
          v-tooltip="'Open code editor'"
          @click="openCodeServer"
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
          @run="runLaunchHandler"
        />
      </div>
    </div>

    <!-- Chat tab -->
    <template v-if="activeTab === 'chat' && task">
      <!-- Chat surface (CopilotKit — D-01: threadId = String(conversationId), D-03) -->
      <div class="tcv-chat">
        <RailyinChat
          :thread-id="String(task.conversationId)"
          :title="task.title"
          :commands-scope="{ taskId: task.id }"
        />
      </div>

      <!-- Changed files panel -->
      <ChangedFilesPanel
        v-if="numstat"
        :task-id="task.id"
        :numstat="numstat"
        :pending-by-file="pendingByFile"
        @open-review="onOpenReview"
      />

      <!-- Todo panel -->
      <TodoPanel
        :task-id="task.id"
        :refresh-trigger="todoRefreshTrigger"
        :board-id="task.boardId"
        :workflow-state="task.workflowState"
      />
    </template>

    <!-- Info tab -->
    <TaskInfoPanel v-else-if="activeTab === 'info' && task" :task-id="task.id" />

    <!-- Git tab -->
    <TaskGitPanel v-else-if="activeTab === 'git' && task" :task-id="task.id" />

    <!-- Decisions tab -->
    <DecisionsPanel v-else-if="activeTab === 'decisions' && task" :conversation-id="task.conversationId" />

    <!-- Notes tab -->
    <NotesPanel
      v-else-if="activeTab === 'notes' && task"
      :conversation-id="task.conversationId"
      :refresh-trigger="notesRefreshTrigger"
    />

    <!-- Manage Models modal -->
    <ManageModelsModal
      v-model="manageModelsOpen"
      :workspace-key="taskWorkspaceKey"
      @close="onManageModelsClosed"
    />

    <!-- Delete confirm dialog -->
    <Dialog
      v-model:visible="deleteDialogVisible"
      header="Delete task"
      :modal="true"
      :style="{ width: '420px' }"
    >
      <p>Are you sure you want to delete <strong>{{ task?.title }}</strong>?</p>
      <p class="delete-warn">This will remove the worktree and all conversation history. The branch will be kept.</p>
      <div v-if="deleteWarning" class="dialog-warning">
        <i class="pi pi-exclamation-triangle" /> Task deleted. {{ deleteWarning }}
      </div>
      <div v-if="deleteError" class="dialog-error">
        <i class="pi pi-exclamation-circle" /> {{ deleteError }}
      </div>
      <template #footer>
        <Button label="Cancel" text @click="deleteDialogVisible = false; deleteError = null; deleteWarning = null" />
        <Button label="Delete" severity="danger" :loading="deleteLoading" :disabled="!!deleteWarning" @click="deleteTask" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useColumnTransitions } from "../composables/useColumnTransitions";
import { Icon } from "@iconify/vue";
import Tag from "primevue/tag";
import Button from "primevue/button";
import Select from "primevue/select";
import Dialog from "primevue/dialog";
import RailyinChat from "./chat/RailyinChat.vue";
import TaskInfoPanel from "./TaskInfoPanel.vue";
import TaskGitPanel from "./TaskGitPanel.vue";
import ChangedFilesPanel from "./ChangedFilesPanel.vue";
import TodoPanel from "./TodoPanel.vue";
import LaunchButtons from "./LaunchButtons.vue";
import ManageModelsModal from "./ManageModelsModal.vue";
import DecisionsPanel from "./DecisionsPanel.vue";
import NotesPanel from "./NotesPanel.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";
import { useWorkspaceStore } from "../stores/workspace";
import { useReviewStore } from "../stores/review";
import { getLaunchConfig, runLaunch } from "../api/launch";
import { useTerminalStore } from "../stores/terminal";
import { useCodeServerStore } from "../stores/codeServer";
import { useDrawerStore } from "../stores/drawer";
import { useToast } from "primevue/usetoast";
import { api } from "../rpc";
import type { LaunchConfig, GitNumstat } from "@shared/rpc-types";

const props = defineProps<{
  taskId: number;
}>();

const taskStore = useTaskStore();
const boardStore = useBoardStore();
const workspaceStore = useWorkspaceStore();
const reviewStore = useReviewStore();
const terminalStore = useTerminalStore();
const codeServerStore = useCodeServerStore();
const drawerStore = useDrawerStore();
const toast = useToast();

// ─── Derived data ─────────────────────────────────────────────────────────────

const task = computed(() => taskStore.activeTask);

const taskWorkspaceKey = computed(() =>
  task.value ? (boardStore.boards.find(b => b.id === task.value!.boardId)?.workspaceKey ?? undefined) : undefined
);

const { selectableColumns } = useColumnTransitions(
  computed(() => boardStore.activeBoard?.template),
  computed(() => task.value?.workflowState),
);

const execLabel = computed(() => {
  const map: Record<string, string> = {
    idle: "Idle", running: "Running…", waiting_user: "Awaiting input",
    waiting_external: "Waiting", failed: "Failed", completed: "Done", cancelled: "Cancelled",
  };
  return task.value ? (map[task.value.executionState] ?? task.value.executionState) : "";
});

const execSeverity = computed((): "secondary" | "info" | "warn" | "danger" | "success" => {
  const map: Record<string, "secondary" | "info" | "warn" | "danger" | "success"> = {
    idle: "secondary", running: "info", waiting_user: "warn",
    waiting_external: "warn", failed: "danger", completed: "success", cancelled: "secondary",
  };
  return task.value ? (map[task.value.executionState] ?? "secondary") : "secondary";
});

// ─── UI state ─────────────────────────────────────────────────────────────────

const activeTab = ref<"chat" | "info" | "git" | "decisions" | "notes">("chat");
const manageModelsOpen = ref(false);
const retrying = ref(false);
const transitioning = ref(false);
const syncingChanges = ref(false);
const deleteDialogVisible = ref(false);
const deleteLoading = ref(false);
const deleteError = ref<string | null>(null);
const deleteWarning = ref<string | null>(null);
const todoRefreshTrigger = ref(0);
const notesRefreshTrigger = ref(0);
const numstat = ref<GitNumstat | null>(null);
const pendingByFile = ref<{ filePath: string; pendingCount: number }[]>([]);
const launchConfig = ref<LaunchConfig | null>(null);

// ─── Shared helper functions ──────────────────────────────────────────────────

async function refreshTaskData() {
  if (!task.value) return;

  // Only clear data that needs to be refreshed
  numstat.value = null;
  pendingByFile.value = [];

  taskStore.loadEnabledModels(taskWorkspaceKey.value);

  if (task.value.worktreeStatus === "ready") {
    numstat.value = await taskStore.getGitStat(task.value.id);
    try {
      pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
    } catch { /* non-fatal */ }
  }

  // Only fetch launch config if not already loaded
  if (!launchConfig.value) {
    launchConfig.value = await getLaunchConfig(task.value.id, task.value.projectKey);
  }
}

async function refreshTaskDataOnExecutionEnd() {
  if (!task.value) return;
  todoRefreshTrigger.value++;
  notesRefreshTrigger.value++;
  numstat.value = await taskStore.getGitStat(task.value.id);
  try {
    pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
  } catch { /* non-fatal */ }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function retry() {
  if (!task.value) return;
  retrying.value = true;
  try { await taskStore.retryTask(task.value.id); } finally { retrying.value = false; }
}

async function transition(toState: string) {
  if (!task.value) return;
  // Guard against null emits (PrimeVue can emit null when model value isn't in
  // options) and no-op transitions (current state re-selected).
  if (!toState || toState === task.value.workflowState) return;
  transitioning.value = true;
  try {
    const boardId = boardStore.activeBoardId;
    const allTasks = boardId != null ? (taskStore.tasksByBoard[boardId] ?? []) : [];
    const minPos = allTasks.filter(t => t.workflowState === toState).reduce((min, t) => Math.min(min, t.position), Infinity);
    const topPosition = isFinite(minPos) ? minPos / 2 : 500;
    await taskStore.transitionTask(task.value.id, toState, topPosition);
  } finally {
    transitioning.value = false;
  }
}

async function openCodeServer() {
  if (!task.value?.worktreePath) return;
  await codeServerStore.openEditor(task.value.id);
}

async function openTerminal() {
  if (!task.value?.worktreePath) return;
  const cwd = task.value.worktreePath;
  const result = await api("launch.shell", { cwd });
  terminalStore.addSession(result.sessionId, task.value.title, cwd);
}

async function onModelChange(model: string | null) {
  if (!task.value) return;
  await taskStore.setModel(task.value.id, model);
}

async function syncChangedFiles() {
  if (!task.value) return;
  syncingChanges.value = true;
  try {
    numstat.value = await taskStore.getGitStat(task.value.id);
    pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
  } finally {
    syncingChanges.value = false;
  }
}

async function onOpenReview(filePath: string | null, mode: "review" | "changes") {
  if (!task.value) return;
  const files = await api("tasks.getChangedFiles", { taskId: task.value.id });
  reviewStore.openReview(task.value.id, files);
  reviewStore.mode = mode;
  if (filePath) reviewStore.selectFile(filePath);
  try {
    pendingByFile.value = await api("tasks.getPendingHunkSummary", { taskId: task.value.id });
  } catch { /* non-fatal */ }
}

async function runLaunchHandler(command: string, mode: "terminal" | "app") {
  if (!task.value) return;
  const result = await runLaunch(task.value.id, command, mode);
  if (!result.ok) {
    toast.add({ severity: "error", summary: "Launch failed", detail: result.error, life: 5000 });
  } else if (result.sessionId) {
    terminalStore.addSession(result.sessionId, task.value.title, task.value.worktreePath ?? "");
  }
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
      setTimeout(() => { deleteDialogVisible.value = false; }, 4000);
    } else {
      deleteDialogVisible.value = false;
    }
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : "Failed to delete task";
  } finally {
    deleteLoading.value = false;
  }
}

async function onManageModelsClosed() {
  await taskStore.loadEnabledModels(taskWorkspaceKey.value);
}

// ─── Watchers ─────────────────────────────────────────────────────────────────

// Initial load when taskId changes
watch(
  () => props.taskId,
  async (id) => {
    if (!id) return;
    launchConfig.value = null; // Reset for new task
    await refreshTaskData();
  },
  { immediate: true },
);

// Update when worktreeStatus changes to ready
watch(
  () => task.value?.worktreeStatus,
  async (newStatus, oldStatus) => {
    if (!task.value) return;
    if (newStatus === "ready" && oldStatus !== "ready") {
      await refreshTaskData();
    }
  },
);

// Update when execution ends
watch(
  () => task.value?.executionState,
  async (state, prev) => {
    if (prev === "running" && state !== "running") {
      await refreshTaskDataOnExecutionEnd();
    }
  },
);

// Safe no-ops: the CopilotKit surface owns its own scroll (CopilotChat
// autoScroll); these stay exposed because ConversationDrawer.onAfterShow
// still calls scheduleScrollToBottomIfAuto on drawer open (drawer:70-72).
defineExpose({
  scrollToBottom: () => {},
  scheduleScrollToBottomIfAuto: () => {},
});
</script>

<style scoped>
.task-chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* CopilotKit chat surface — flex child filling the space between the toolbar
   and the changed-files/todo panels (ConversationBody's flex:1 contract). */
.tcv-chat {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tcv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px 6px;
  border-bottom: 1px solid var(--p-content-border-color);
  min-height: 48px;
}

.tcv-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.tcv-header__title {
  font-weight: 600;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tcv-header__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.tcv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.tab-switcher {
  display: flex;
  gap: 2px;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--p-text-muted-color);
  transition: background 0.15s, color 0.15s;
}

.tab-btn:hover {
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
}

.tab-btn--active {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
  font-weight: 600;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.workflow-select {
  font-size: 0.8rem;
}

.delete-warn {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.dialog-warning {
  color: var(--p-yellow-500, #eab308);
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.dialog-error {
  color: var(--p-red-500, #ef4444);
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
</style>
