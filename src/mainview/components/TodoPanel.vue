<template>
  <div v-if="todos.length > 0 || expanded" class="todo-panel" :class="{ 'todo-panel--expanded': expanded }">
    <button class="todo-panel__header" @click="expanded = !expanded">
      <span class="todo-panel__toggle">{{ expanded ? '▼' : '▶' }}</span>
      <span v-if="!expanded" class="todo-panel__summary">{{ doneCount }} / {{ todos.length }} · Todos</span>
      <span v-else class="todo-panel__summary">Todos</span>
      <button
        v-if="expanded"
        class="todo-panel__add-btn"
        @click.stop="openCreate"
        title="New todo"
      >+</button>
    </button>
    <ul v-if="expanded" class="todo-panel__list">
      <li
        v-for="todo in todos"
        :key="todo.id"
        class="todo-panel__item"
        :class="`todo-panel__item--${todo.status}`"
        @click="openEdit(todo)"
      >
        <span class="todo-panel__icon">{{ statusIcon(todo.status) }}</span>
        <span class="todo-panel__num">{{ todo.number }}</span>
        <span class="todo-panel__title">{{ todo.title }}</span>
        <button
          class="todo-panel__delete-btn"
          @click.stop="deleteTodoItem(todo)"
          title="Delete"
        >✕</button>
      </li>
    </ul>

    <TodoDetailOverlay
      v-if="overlayVisible"
      :visible="overlayVisible"
      :task-id="props.taskId"
      :todo-id="overlayTodoId"
      @close="overlayVisible = false"
      @saved="onSaved"
      @deleted="onDeleted"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { electroview } from "../rpc";
import type { TodoListItem } from "@shared/rpc-types";
import TodoDetailOverlay from "./TodoDetailOverlay.vue";

const props = defineProps<{ taskId: number; refreshTrigger?: number }>();

const todos = ref<TodoListItem[]>([]);
const expanded = ref(false);
const overlayVisible = ref(false);
const overlayTodoId = ref<number | null>(null);
const doneCount = computed(() => todos.value.filter((t) => t.status === "done").length);

function statusIcon(status: string): string {
  if (status === "done") return "✓";
  if (status === "in-progress") return "●";
  if (status === "blocked") return "⊘";
  return "○";
}

async function fetchTodos() {
  try {
    todos.value = await electroview.rpc!.request["todos.list"]({ taskId: props.taskId });
  } catch {
    // silently ignore — todos are non-critical
  }
}

function openCreate() {
  overlayTodoId.value = null;
  overlayVisible.value = true;
}

function openEdit(todo: TodoListItem) {
  overlayTodoId.value = todo.id;
  overlayVisible.value = true;
}

async function deleteTodoItem(todo: TodoListItem) {
  try {
    await electroview.rpc!.request["todos.edit"]({ taskId: props.taskId, todoId: todo.id, status: "deleted" });
    await fetchTodos();
  } catch {
    // silently ignore
  }
}

function onSaved() {
  overlayVisible.value = false;
  fetchTodos();
}

function onDeleted() {
  overlayVisible.value = false;
  fetchTodos();
}

watch(() => props.taskId, fetchTodos, { immediate: true });
watch(() => props.refreshTrigger, fetchTodos);
</script>

<style scoped>
.todo-panel {
  border-top: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
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
  background: var(--p-content-hover-background);
}

.todo-panel__toggle {
  font-size: 0.65rem;
  color: var(--p-text-muted-color, #9ca3af);
}

.todo-panel__summary {
  font-weight: 500;
  flex: 1;
}

.todo-panel__add-btn {
  margin-left: auto;
  background: none;
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #6b7280);
  line-height: 1;
  padding: 0;
}

.todo-panel__add-btn:hover {
  background: var(--p-primary-color, #6366f1);
  color: white;
  border-color: transparent;
}

.todo-panel__list {
  list-style: none;
  margin: 0;
  padding: 4px 12px 8px 12px;
}

.todo-panel__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 0.8rem;
  color: var(--p-text-color, #374151);
  cursor: pointer;
}

.todo-panel__item:hover {
  background: var(--p-content-hover-background);
  border-radius: 4px;
  margin: 0 -4px;
  padding: 3px 4px;
}

.todo-panel__icon {
  flex-shrink: 0;
  width: 14px;
  font-size: 0.7rem;
}

.todo-panel__num {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #9ca3af);
  min-width: 20px;
}

.todo-panel__title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-panel__delete-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.65rem;
  color: var(--p-text-muted-color, #9ca3af);
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.1s;
}

.todo-panel__item:hover .todo-panel__delete-btn {
  opacity: 1;
}

.todo-panel__delete-btn:hover {
  color: var(--p-red-500, #ef4444);
}

.todo-panel__item--done .todo-panel__title {
  text-decoration: line-through;
  color: var(--p-text-muted-color, #9ca3af);
}

.todo-panel__item--done .todo-panel__icon {
  color: #22c55e;
}

.todo-panel__item--in-progress .todo-panel__icon {
  color: #f59e0b;
}

.todo-panel__item--blocked .todo-panel__icon {
  color: #ef4444;
}
</style>
