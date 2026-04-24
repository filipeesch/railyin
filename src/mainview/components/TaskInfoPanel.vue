<template>
  <div class="task-info-panel task-tab-info">
    <TaskInfoTab
      :task="task"
      :board="currentBoard"
      :branches="branches"
      :create-loading="createLoading"
      :create-error="createError"
      :remove-loading="removeLoading"
      :remove-warning="removeWarning"
      :worktree-base-path="workspaceStore.config?.worktreeBasePath ?? ''"
      @edit="overlayVisible = true"
      @create-worktree="onCreateWorktree"
      @remove-worktree="onRemoveWorktree"
    />
    <TaskDetailOverlay
      v-if="task"
      :visible="overlayVisible"
      :task-id="task.id"
      :board-id="task.boardId"
      @close="overlayVisible = false"
      @saved="onTaskSaved"
      @deleted="onTaskDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import TaskInfoTab from "./TaskInfoTab.vue";
import TaskDetailOverlay from "./TaskDetailOverlay.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";
import { useWorkspaceStore } from "../stores/workspace";
import { api } from "../rpc";

const props = defineProps<{
  taskId: number;
}>();

const taskStore = useTaskStore();
const boardStore = useBoardStore();
const workspaceStore = useWorkspaceStore();

const task = computed(() => taskStore.activeTask);
const currentBoard = computed(() =>
  task.value ? (boardStore.boards.find(b => b.id === task.value!.boardId) ?? null) : null
);

// ─── Worktree management ──────────────────────────────────────────────────────

const branches = ref<string[]>([]);
const createLoading = ref(false);
const createError = ref<string | null>(null);
const removeLoading = ref(false);
const removeWarning = ref<string | null>(null);
const overlayVisible = ref(false);

async function fetchBranches() {
  try {
    const result = await api("tasks.listBranches", { taskId: props.taskId });
    branches.value = result.branches;
  } catch {
    branches.value = [];
  }
}

async function onCreateWorktree(params: { mode: "new" | "existing"; branchName: string; path: string; sourceBranch?: string }) {
  createLoading.value = true;
  createError.value = null;
  try {
    await api("tasks.createWorktree", { taskId: props.taskId, ...params });
  } catch (err) {
    createError.value = err instanceof Error ? err.message : "Failed to create worktree";
  } finally {
    createLoading.value = false;
  }
}

async function onRemoveWorktree() {
  removeLoading.value = true;
  removeWarning.value = null;
  try {
    const result = await api("tasks.removeWorktree", { taskId: props.taskId });
    if (result?.warning) removeWarning.value = result.warning;
  } finally {
    removeLoading.value = false;
  }
}

function onTaskSaved() {
  overlayVisible.value = false;
  if (task.value) taskStore.loadTasks(task.value.boardId);
}

function onTaskDeleted() {
  overlayVisible.value = false;
  taskStore.closeTask();
}

watch(
  () => task.value?.worktreeStatus,
  async (status) => {
    removeWarning.value = null;
    if (!task.value) return;
    if (status === "not_created" || status === "removed" || status === "error") {
      await fetchBranches();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.task-info-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
</style>
