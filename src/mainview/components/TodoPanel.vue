<template>
  <div v-if="todos.length > 0" class="todo-panel" :class="{ 'todo-panel--expanded': expanded }">
    <button class="todo-panel__header" @click="expanded = !expanded">
      <span class="todo-panel__toggle">{{ expanded ? '▼' : '▶' }}</span>
      <span v-if="!expanded" class="todo-panel__summary">{{ completedCount }} / {{ todos.length }} · Todos</span>
      <span v-else class="todo-panel__summary">Todos</span>
    </button>
    <ul v-if="expanded" class="todo-panel__list">
      <li v-for="todo in todos" :key="todo.id" class="todo-panel__item" :class="`todo-panel__item--${todo.status}`">
        <span class="todo-panel__icon">{{ statusIcon(todo.status) }}</span>
        <span class="todo-panel__title">{{ todo.title }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { electroview } from "../rpc";
import type { TodoItem } from "@shared/rpc-types";

const props = defineProps<{ taskId: number; refreshTrigger?: number }>();

const todos = ref<TodoItem[]>([]);
const expanded = ref(false);

const completedCount = computed(() => todos.value.filter((t) => t.status === "completed").length);

function statusIcon(status: string): string {
  if (status === "completed") return "✓";
  if (status === "in-progress") return "●";
  return "○";
}

async function fetchTodos() {
  try {
    todos.value = await electroview.rpc!.request["todos.list"]({ taskId: props.taskId });
  } catch {
    // silently ignore — todos are non-critical
  }
}

watch(() => props.taskId, fetchTodos, { immediate: true });
watch(() => props.refreshTrigger, fetchTodos);
</script>

<style scoped>
.todo-panel {
  border-top: 1px solid var(--p-surface-200, #e5e7eb);
  background: var(--p-surface-50, #f9fafb);
}

.todo-panel__header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #6b7280);
  text-align: left;
}

.todo-panel__header:hover {
  background: var(--p-surface-100, #f3f4f6);
}

.todo-panel__toggle {
  font-size: 0.65rem;
  color: var(--p-text-muted-color, #9ca3af);
}

.todo-panel__summary {
  font-weight: 500;
}

.todo-panel__list {
  list-style: none;
  margin: 0;
  padding: 4px 12px 8px 12px;
}

.todo-panel__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 0.8rem;
  color: var(--p-text-color, #374151);
}

.todo-panel__icon {
  flex-shrink: 0;
  width: 14px;
  font-size: 0.7rem;
}

.todo-panel__item--completed .todo-panel__title {
  text-decoration: line-through;
  color: var(--p-text-muted-color, #9ca3af);
}

.todo-panel__item--completed .todo-panel__icon {
  color: #22c55e;
}

.todo-panel__item--in-progress .todo-panel__icon {
  color: #f59e0b;
}
</style>
