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
      <span v-if="task.retryCount > 0" class="task-card__retry-count">
        ↺ {{ task.retryCount }}
      </span>
      <span
        v-if="changedCount > 0"
        class="task-card__changed-badge"
        :title="`${changedCount} file${changedCount !== 1 ? 's' : ''} changed — click to review`"
        @click.stop="emit('openReview')"
      >⬡ {{ changedCount }}</span>
    </div>

    <!-- Launch buttons: only when worktree is ready -->
    <div v-if="launchConfig && task.worktreePath" class="task-card__launch-row">
      <LaunchButtons
        :profiles="launchConfig.profiles"
        :tools="launchConfig.tools"
        :card-mode="true"
        @click.stop
        @pointerdown.stop
        @run="runLaunch"
      />
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Tag from "primevue/tag";
import { useToast } from "primevue/usetoast";
import LaunchButtons from "./LaunchButtons.vue";
import type { Task, LaunchConfig } from "@shared/rpc-types";
import { useTaskStore } from "../stores/task";
import { useLaunchStore } from "../stores/launch";

const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ click: []; openReview: []; openTerminal: [sessionId: string] }>();
const taskStore = useTaskStore();
const launchStore = useLaunchStore();
const toast = useToast();
const changedCount = computed(() => taskStore.changedFileCounts[props.task.id] ?? 0);
const isUnread = computed(() => taskStore.hasUnread(props.task.id));

const launchConfig = ref<LaunchConfig | null>(null);

onMounted(async () => {
  launchConfig.value = await launchStore.getConfig(props.task.id, props.task.projectKey);
});

async function runLaunch(command: string, mode: "terminal" | "app") {
  const result = await launchStore.run(props.task.id, command, mode);
  if (!result.ok) {
    toast.add({ severity: "error", summary: "Launch failed", detail: result.error, life: 5000 });
  } else if (result.sessionId) {
    emit("openTerminal", result.sessionId);
  }
}

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
}

.task-card__launch-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}

.task-card__retry-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
}

.task-card__changed-badge {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-primary-color);
  background: var(--p-highlight-background);
  border: 1px solid color-mix(in srgb, var(--p-primary-color) 30%, transparent);
  border-radius: 10px;
  padding: 1px 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}

.task-card__changed-badge:hover {
  background: var(--p-highlight-focus-background);
}


</style>
