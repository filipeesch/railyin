<template>
  <div class="task-card" :class="[`exec-${task.executionState}`]" @click="emit('click')">
    <!-- Title -->
    <div class="task-card__title">{{ task.title }}</div>

    <!-- Execution state badge -->
    <div class="task-card__footer">
      <Tag
        :value="execLabel"
        :severity="execSeverity"
        rounded
      />
      <span v-if="task.retryCount > 0" class="task-card__retry-count">
        ↺ {{ task.retryCount }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Tag from "primevue/tag";
import type { Task } from "@shared/rpc-types";

const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ click: [] }>();

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
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
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

.task-card__footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-card__retry-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
}
</style>
