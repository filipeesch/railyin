<template>
  <div class="task-tab-git task-git-panel">
    <TaskGitTab
      :task="task"
      :branches="branches"
      :create-loading="createLoading"
      :create-error="createError"
      :remove-loading="removeLoading"
      :remove-warning="removeWarning"
      :worktree-base-path="workspaceStore.config?.worktreeBasePath ?? ''"
      @create-worktree="onCreateWorktree"
      @remove-worktree="onRemoveWorktree"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import TaskGitTab from "./TaskGitTab.vue";
import { useTaskStore } from "../stores/task";
import { useWorkspaceStore } from "../stores/workspace";
import { api } from "../rpc";

const props = defineProps<{
  taskId: number;
}>();

const taskStore = useTaskStore();
const workspaceStore = useWorkspaceStore();

const task = computed(() => taskStore.activeTask);

const branches = ref<string[]>([]);
const createLoading = ref(false);
const createError = ref<string | null>(null);
const removeLoading = ref(false);
const removeWarning = ref<string | null>(null);

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
.task-git-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
</style>
