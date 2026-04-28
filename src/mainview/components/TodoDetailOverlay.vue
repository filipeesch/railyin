<template>
  <Teleport to="body">
    <div v-if="visible" class="todo-overlay" @mousedown.stop @keydown.esc="onClose">
      <!-- Header -->
      <div class="todo-overlay__header">
        <div class="todo-overlay__title">
          <i class="pi pi-list" />
          <span>{{ form.title }}</span>
        </div>
        <div class="todo-overlay__header-actions">
          <Button
            v-if="props.todoId != null && isPending"
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            aria-label="Delete todo"
            :disabled="saving"
            @click="onDelete"
          />
          <Button
            icon="pi pi-times"
            severity="secondary"
            text
            rounded
            aria-label="Close"
            @click="onClose"
          />
        </div>
      </div>

      <!-- Body -->
      <div class="todo-overlay__body">
        <div class="todo-overlay__toolbar">
          <button
            class="todo-overlay__tab"
            :class="{ 'todo-overlay__tab--active': !editMode }"
            @click="editMode = false"
          >Preview</button>
          <button
            v-if="isPending"
            class="todo-overlay__tab"
            :class="{ 'todo-overlay__tab--active': editMode }"
            @click="editMode = true"
          >Edit</button>
        </div>

        <div v-if="editMode && isPending" class="todo-overlay__edit">
          <textarea
            v-model="form.description"
            class="todo-overlay__textarea"
            placeholder="Write a rich markdown description — what to do, why, files involved, constraints, acceptance criteria. This is a context memory."
          />
        </div>
        <div
          v-else
          class="todo-overlay__preview markdown-content"
          v-html="renderedDescription"
        />
      </div>

      <!-- Footer (only for pending) -->
      <div v-if="isPending" class="todo-overlay__footer">
        <span v-if="error" class="todo-overlay__error">{{ error }}</span>
        <div class="todo-overlay__footer-actions">
          <Button label="Cancel" severity="secondary" @click="onClose" :disabled="saving" />
          <Button label="Save" severity="primary" :loading="saving" @click="onSave" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import { useMarkdown } from "../composables/useMarkdown";
import { api } from "../rpc";
import type { TodoStatus } from "@shared/rpc-types";
import Button from "primevue/button";

const props = defineProps<{
  visible: boolean;
  taskId: number;
  todoId: number | null;
  boardId: number;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  deleted: [];
}>();

const editMode = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);

const form = reactive({
  number: 10,
  title: "",
  description: "",
  status: "pending" as TodoStatus,
  phase: null as string | null,
});

const isPending = computed(() => form.status === "pending");

const { renderMd } = useMarkdown();

const renderedDescription = computed(() => {
  if (!form.description) return "<p><em>No description yet.</em></p>";
  return renderMd(form.description);
});

async function loadTodo() {
  if (props.todoId == null) {
    form.number = 10;
    form.title = "";
    form.description = "";
    form.status = "pending";
    form.phase = null;
    editMode.value = true;
    return;
  }
  try {
    const todo = await api("todos.get", { taskId: props.taskId, todoId: props.todoId });
    if (todo) {
      form.number = todo.number;
      form.title = todo.title;
      form.description = todo.description;
      form.status = todo.status;
      form.phase = todo.phase ?? null;
      editMode.value = false;
    }
  } catch {
    error.value = "Failed to load todo";
  }
}

async function onSave() {
  if (!form.title.trim()) return;
  saving.value = true;
  error.value = null;
  try {
    if (props.todoId == null) {
      await api("todos.create", {
        taskId: props.taskId,
        number: form.number,
        title: form.title.trim(),
        description: form.description,
        phase: form.phase || null,
      });
    } else {
      await api("todos.edit", {
        taskId: props.taskId,
        todoId: props.todoId,
        number: form.number,
        title: form.title.trim(),
        description: form.description,
        phase: form.phase || null,
      });
    }
    emit("saved");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to save";
  } finally {
    saving.value = false;
  }
}

async function onDelete() {
  if (props.todoId == null) return;
  saving.value = true;
  error.value = null;
  try {
    await api("todos.delete", { taskId: props.taskId, todoId: props.todoId });
    emit("deleted");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to delete";
  } finally {
    saving.value = false;
  }
}

function onClose() {
  emit("close");
}

watch(
  () => [props.visible, props.todoId] as const,
  ([visible]) => {
    if (visible) {
      error.value = null;
      loadTodo();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.todo-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--p-surface-0, #fff);
  display: flex;
  flex-direction: column;
}

.todo-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.todo-overlay__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.todo-overlay__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* Body */
.todo-overlay__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.todo-overlay__toolbar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.todo-overlay__tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--p-text-muted-color);
  margin-bottom: -1px;
}

.todo-overlay__tab--active {
  border-bottom-color: var(--p-primary-color);
  color: var(--p-primary-color);
  font-weight: 500;
}

.todo-overlay__edit {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.todo-overlay__textarea {
  flex: 1;
  resize: none;
  border: none;
  padding: 12px 16px;
  font-size: 0.85rem;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  line-height: 1.5;
  background: var(--p-content-background);
  color: var(--p-text-color);
}

.todo-overlay__textarea:focus {
  outline: none;
}

.todo-overlay__preview {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--p-text-color);
}

/* Footer */
.todo-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
  gap: 1rem;
}

.todo-overlay__error {
  flex: 1;
  font-size: 0.8rem;
  color: var(--p-red-500, #ef4444);
}

.todo-overlay__footer-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Markdown preview styles */
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin: 0.5em 0 0.25em;
  font-weight: 600;
}

.markdown-content :deep(p) {
  margin: 0.4em 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.5em;
}

.markdown-content :deep(code) {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.85em;
  background: var(--p-content-hover-background);
  padding: 1px 4px;
  border-radius: 3px;
}

.markdown-content :deep(pre) {
  background: var(--p-content-hover-background);
  border-radius: 4px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.5em 0;
}

.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
}
</style>

<style>
/* Dark mode overrides */
html.dark-mode .todo-overlay {
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .todo-overlay__header {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .todo-overlay__footer {
  border-top-color: var(--p-surface-700, #334155);
}
</style>
