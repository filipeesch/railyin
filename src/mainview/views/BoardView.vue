<template>
  <div class="board-view">
    <!-- Header bar -->
    <div class="board-header">
      <div class="board-header__left">
        <Select
          v-model="boardStore.activeBoardId"
          :options="boardStore.boards"
          option-label="name"
          option-value="id"
          placeholder="Select board"
          class="board-selector"
          @change="onBoardChange"
        />
      </div>
      <div class="board-header__right">
        <Button
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="Settings"
          @click="router.push('/setup')"
        />
        <Button
          v-if="boardStore.activeBoard"
          label="New Task"
          icon="pi pi-plus"
          @click="showCreateTask = true"
        />
      </div>
    </div>

    <!-- Board columns -->
    <div v-if="boardStore.activeBoard" class="board-columns">
      <div
        v-for="column in boardStore.activeBoard.template.columns"
        :key="column.id"
        class="board-column"
        @dragover.prevent
        @drop="onDrop($event, column.id)"
      >
        <!-- Column header -->
        <div class="board-column__header">
          <span class="board-column__name">{{ column.label }}</span>
          <Badge
            :value="columnTasks(column.id).length"
            severity="secondary"
          />
        </div>

        <!-- Task cards -->
        <div class="board-column__cards">
          <TaskCard
            v-for="task in columnTasks(column.id)"
            :key="task.id"
            :task="task"
            draggable="true"
            @dragstart="onDragStart($event, task.id)"
            @click="taskStore.selectTask(task.id)"
          />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!boardStore.loading" class="board-empty">
      <i class="pi pi-inbox" style="font-size: 3rem; color: var(--p-text-muted-color)" />
      <p>No boards yet. <a href="#" @click.prevent="router.push('/setup')">Create one in setup.</a></p>
    </div>

    <!-- Task detail drawer -->
    <TaskDetailDrawer />

    <!-- Create task dialog -->
    <CreateTaskDialog
      v-if="boardStore.activeBoardId"
      v-model:visible="showCreateTask"
      :board-id="boardStore.activeBoardId"
      @created="onTaskCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import Select from "primevue/select";
import Button from "primevue/button";
import Badge from "primevue/badge";
import { useBoardStore } from "../stores/board";
import { useTaskStore } from "../stores/task";
import { useProjectStore } from "../stores/project";
import TaskCard from "../components/TaskCard.vue";
import TaskDetailDrawer from "../components/TaskDetailDrawer.vue";
import CreateTaskDialog from "../components/CreateTaskDialog.vue";

const router = useRouter();
const boardStore = useBoardStore();
const taskStore = useTaskStore();
const projectStore = useProjectStore();

const showCreateTask = ref(false);
const draggingTaskId = ref<number | null>(null);

// Load tasks when active board changes
watch(
  () => boardStore.activeBoardId,
  async (id) => {
    if (id != null) {
      await taskStore.loadTasks(id);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await projectStore.loadProjects();
});

function columnTasks(columnId: string) {
  const boardId = boardStore.activeBoardId;
  if (!boardId) return [];
  return (taskStore.tasksByBoard[boardId] ?? []).filter(
    (t) => t.workflowState === columnId,
  );
}

async function onBoardChange() {
  const id = boardStore.activeBoardId;
  if (id != null) await taskStore.loadTasks(id);
}

function onDragStart(event: DragEvent, taskId: number) {
  draggingTaskId.value = taskId;
  event.dataTransfer?.setData("text/plain", String(taskId));
}

async function onDrop(event: DragEvent, columnId: string) {
  const taskIdStr = event.dataTransfer?.getData("text/plain");
  const taskId = taskIdStr ? Number(taskIdStr) : null;
  if (!taskId) return;

  const task = Object.values(taskStore.tasksByBoard)
    .flat()
    .find((t) => t.id === taskId);

  if (!task || task.workflowState === columnId) return;

  await taskStore.transitionTask(taskId, columnId);
  draggingTaskId.value = null;
}

async function onTaskCreated() {
  const id = boardStore.activeBoardId;
  if (id != null) await taskStore.loadTasks(id);
}
</script>

<style scoped>
.board-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  background: var(--p-surface-0, #fff);
  gap: 12px;
  flex-shrink: 0;
}

.board-header__left,
.board-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.board-selector {
  min-width: 200px;
}

.board-columns {
  display: flex;
  flex: 1;
  gap: 12px;
  padding: 16px;
  overflow-x: auto;
  overflow-y: hidden;
  align-items: flex-start;
}

.board-column {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  background: var(--p-surface-100, #f1f5f9);
  border-radius: 10px;
  padding: 12px;
  max-height: 100%;
}

.board-column__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.board-column__name {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.board-column__cards {
  flex: 1;
  overflow-y: auto;
  min-height: 60px;
}

.board-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--p-text-muted-color, #94a3b8);
}
</style>
