<template>
  <div class="task-info-panel task-tab-info">
    <TaskInfoTab
      :task="task"
      :board="currentBoard"
      @edit="overlayVisible = true"
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
import { ref, computed } from "vue";
import TaskInfoTab from "./TaskInfoTab.vue";
import TaskDetailOverlay from "./TaskDetailOverlay.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";

const props = defineProps<{
  taskId: number;
}>();

const taskStore = useTaskStore();
const boardStore = useBoardStore();

const task = computed(() => taskStore.activeTask);
const currentBoard = computed(() =>
  task.value ? (boardStore.boards.find(b => b.id === task.value!.boardId) ?? null) : null
);

const overlayVisible = ref(false);

function onTaskSaved() {
  overlayVisible.value = false;
  if (task.value) taskStore.loadTasks(task.value.boardId);
}

function onTaskDeleted() {
  overlayVisible.value = false;
  taskStore.closeTask();
}
</script>

<style scoped>
.task-info-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
</style>
