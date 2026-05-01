<template>
  <div class="task-card" :class="[`exec-${task.executionState}`]" :data-task-id="task.id" @click="emit('click')">
    <!-- Title -->
    <div class="task-card__title-row">
      <div class="task-card__title">{{ task.title }}</div>
      <span v-if="isUnread" class="task-card__unread-dot" aria-label="Unread activity" />
    </div>

    <!-- Execution state badge + changed files badge -->
    <div class="task-card__footer">
      <Tag
        :value="execLabel"
        :severity="execSeverity"
        rounded
      />
      <span class="task-card__project">{{ projectName }}</span>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Tag from "primevue/tag";
import type { Task } from "@shared/rpc-types";
import { useTaskStore } from "../stores/task";
import { useProjectStore } from "../stores/project";

const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ click: [] }>();
const taskStore = useTaskStore();
const projectStore = useProjectStore();
const projectName = computed(() => projectStore.projects.find(p => p.key === props.task.projectKey)?.name ?? props.task.projectKey);
const isUnread = computed(() => taskStore.hasUnread(props.task.id));

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
  return map[props.task.executionState] ?? props.task.executionState;
});

const execSeverity = computed(() => {
  const map: Record<string, "secondary" | "info" | "warn" | "danger" | "success" | "contrast"> = {
    idle: "secondary",
    running: "info",
    waiting_user: "warn",
    waiting_external: "warn",
    failed: "danger",
    completed: "success",
    cancelled: "secondary",
  };
  return map[props.task.executionState] ?? "secondary";
});
</script>

<style scoped>
.task-card {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 12px;
  cursor: default;
  transition: box-shadow 0.15s;
  margin-bottom: 8px;
}

.task-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.task-card.exec-running {
  border-left: 3px solid var(--p-primary-color, #6366f1);
}

.task-card.exec-failed {
  border-left: 3px solid var(--p-red-400, #f87171);
}

.task-card__title {
  font-weight: 500;
  font-size: 0.9rem;
  margin-bottom: 8px;
  line-height: 1.4;
}

.task-card__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.task-card__unread-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  margin-top: 2px;
  border-radius: 999px;
  background: var(--p-blue-500, #3b82f6);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-blue-500, #3b82f6) 18%, transparent);
}

.task-card__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}

.task-card__project {
  font-size: 0.72rem;
  color: var(--p-text-muted-color, #94a3b8);
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


</style>
