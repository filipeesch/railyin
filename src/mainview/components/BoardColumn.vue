<template>
  <div
    class="board-column"
    :class="{
      'is-drag-over': isDragOver && !isAtCapacity && !isForbidden,
      'is-drag-over--full': isDragOver && isAtCapacity,
      'is-drag-forbidden': isForbidden,
    }"
    :data-column-id="column.id"
    @drop.prevent
  >
    <div class="board-column__header">
      <span class="board-column__name">{{ column.label }}</span>
      <Badge
        :value="column.limit != null ? `${tasks.length}/${column.limit}` : tasks.length"
        :severity="isAtCapacity ? 'danger' : 'secondary'"
      />
    </div>
    <div v-if="column.id === 'backlog'" class="board-column__create-task">
      <Button label="New Task" icon="pi pi-plus" @click="$emit('create-task')" />
    </div>
    <div class="board-column__cards">
      <TaskCard
        v-for="task in tasks"
        :key="task.id"
        :task="task"
        v-memo="[task, hasUnread(task.id), changedFileCounts[task.id]]"
        @pointerdown="$emit('card-pointerdown', $event, task.id)"
        @click="$emit('card-click', task.id)"
        @open-review="$emit('open-review', task.id)"
      />
      <div
        v-if="isDragOver"
        class="drop-indicator"
        :style="{ top: dropIndicatorY + 'px' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import Badge from "primevue/badge";
import Button from "primevue/button";
import TaskCard from "./TaskCard.vue";
import type { WorkflowColumn } from "../../shared/rpc-types.ts";
import type { Task } from "../../shared/rpc-types.ts";

defineProps<{
  column: WorkflowColumn;
  tasks: Task[];
  isDragOver: boolean;
  isAtCapacity: boolean;
  isForbidden: boolean;
  dropIndicatorY: number;
  hasUnread: (taskId: number) => boolean;
  changedFileCounts: Record<number, number | undefined>;
}>();

defineEmits<{
  "create-task": [];
  "card-pointerdown": [event: PointerEvent, taskId: number];
  "card-click": [taskId: number];
  "open-review": [taskId: number];
}>();
</script>

<style scoped>
.board-column {
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  background: var(--p-content-hover-background);
  border-radius: 10px;
  padding: 12px;
  min-height: 120px;
  transition: outline 0.1s, opacity 0.15s;
}

.board-column.is-drag-over {
  background: color-mix(in srgb, var(--p-primary-color, #6366f1) 8%, var(--p-content-hover-background));
}

.board-column.is-drag-over--full {
  outline: 2px dashed var(--p-danger-color, #ef4444);
}

.board-column.is-drag-forbidden {
  opacity: 0.4;
  pointer-events: none;
  cursor: not-allowed;
}

.board-column__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.board-column__create-task {
  padding: 0 4px 12px 4px;
  margin-bottom: 8px;
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
  min-height: 60px;
  position: relative;
}

.drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--p-primary-color, #6366f1);
  border-radius: 2px;
  pointer-events: none;
  z-index: 10;
}
</style>
