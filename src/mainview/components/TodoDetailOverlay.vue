<template>
  <Teleport to="body">
    <div v-if="visible" class="todo-overlay-backdrop" @click.self="onClose">
      <div class="todo-overlay" @keydown.esc="onClose">
        <!-- Header -->
        <div class="todo-overlay__header">
          <div class="todo-overlay__meta">
            <input
              v-model.number="form.number"
              type="number"
              step="any"
              class="todo-overlay__number-input"
              placeholder="#"
              title="Execution order"
            />
            <input
              v-model="form.title"
              type="text"
              class="todo-overlay__title-input"
              placeholder="Todo title"
            />
          </div>
          <div class="todo-overlay__header-actions">
            <select v-model="form.status" class="todo-overlay__status-select">
              <option value="pending">pending</option>
              <option value="in-progress">in-progress</option>
              <option value="done">done</option>
              <option value="blocked">blocked</option>
            </select>
            <button
              v-if="props.todoId != null"
              class="todo-overlay__icon-btn todo-overlay__icon-btn--danger"
              title="Delete todo"
              :disabled="saving"
              @click="onDelete"
            >✕</button>
            <button class="todo-overlay__icon-btn" title="Close" @click="onClose">✕</button>
          </div>
        </div>

        <!-- Description -->
        <div class="todo-overlay__body">
          <div class="todo-overlay__toolbar">
            <button
              class="todo-overlay__tab"
              :class="{ 'todo-overlay__tab--active': !editMode }"
              @click="editMode = false"
            >Preview</button>
            <button
              class="todo-overlay__tab"
              :class="{ 'todo-overlay__tab--active': editMode }"
              @click="editMode = true"
            >Edit</button>
          </div>

          <div v-if="editMode" class="todo-overlay__edit">
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

        <!-- Footer -->
        <div class="todo-overlay__footer">
          <span v-if="error" class="todo-overlay__error">{{ error }}</span>
          <div class="todo-overlay__footer-actions">
            <button class="todo-overlay__btn todo-overlay__btn--secondary" @click="onClose" :disabled="saving">Cancel</button>
            <button class="todo-overlay__btn todo-overlay__btn--primary" @click="onSave" :disabled="saving || !form.title.trim()">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import { marked } from "marked";
import { electroview } from "../rpc";
import type { TodoStatus } from "@shared/rpc-types";

const props = defineProps<{
  visible: boolean;
  taskId: number;
  todoId: number | null;
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
});

const renderedDescription = computed(() => {
  if (!form.description) return "<p><em>No description yet.</em></p>";
  return marked.parse(form.description, { async: false, breaks: true, gfm: true }) as string;
});

async function loadTodo() {
  if (props.todoId == null) {
    form.number = 10;
    form.title = "";
    form.description = "";
    form.status = "pending";
    editMode.value = true;
    return;
  }
  try {
    const todo = await electroview.rpc!.request["todos.get"]({ taskId: props.taskId, todoId: props.todoId });
    if (todo) {
      form.number = todo.number;
      form.title = todo.title;
      form.description = todo.description;
      form.status = todo.status;
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
      await electroview.rpc!.request["todos.create"]({
        taskId: props.taskId,
        number: form.number,
        title: form.title.trim(),
        description: form.description,
      });
    } else {
      await electroview.rpc!.request["todos.edit"]({
        taskId: props.taskId,
        todoId: props.todoId,
        number: form.number,
        title: form.title.trim(),
        description: form.description,
        status: form.status,
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
    await electroview.rpc!.request["todos.delete"]({ taskId: props.taskId, todoId: props.todoId });
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
.todo-overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.todo-overlay {
  background: var(--p-surface-0, #fff);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  width: 620px;
  max-width: 95vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.todo-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.todo-overlay__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.todo-overlay__number-input {
  width: 60px;
  font-size: 0.8rem;
  padding: 3px 6px;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 4px;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #374151);
  flex-shrink: 0;
}

.todo-overlay__title-input {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 3px 8px;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 4px;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #1e293b);
  min-width: 0;
}

.todo-overlay__title-input:focus,
.todo-overlay__number-input:focus {
  outline: none;
  border-color: var(--p-primary-color, #6366f1);
}

.todo-overlay__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.todo-overlay__status-select {
  font-size: 0.75rem;
  padding: 3px 6px;
  border: 1px solid var(--p-surface-300, #cbd5e1);
  border-radius: 4px;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #374151);
}

.todo-overlay__icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #9ca3af);
  padding: 4px 6px;
  border-radius: 4px;
}

.todo-overlay__icon-btn:hover {
  background: var(--p-surface-100, #f1f5f9);
  color: var(--p-text-color, #374151);
}

.todo-overlay__icon-btn--danger:hover {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-600, #dc2626);
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
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.todo-overlay__tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--p-text-muted-color, #6b7280);
  margin-bottom: -1px;
}

.todo-overlay__tab--active {
  border-bottom-color: var(--p-primary-color, #6366f1);
  color: var(--p-primary-color, #6366f1);
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
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #374151);
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
  color: var(--p-text-color, #374151);
}

/* Footer */
.todo-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  background: var(--p-surface-50, #f8fafc);
  flex-shrink: 0;
}

.todo-overlay__error {
  flex: 1;
  font-size: 0.8rem;
  color: var(--p-red-600, #dc2626);
}

.todo-overlay__footer-actions {
  display: flex;
  gap: 8px;
}

.todo-overlay__btn {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  border: 1px solid transparent;
}

.todo-overlay__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.todo-overlay__btn--secondary {
  background: none;
  border-color: var(--p-surface-300, #cbd5e1);
  color: var(--p-text-color, #374151);
}

.todo-overlay__btn--secondary:hover:not(:disabled) {
  background: var(--p-surface-100, #f1f5f9);
}

.todo-overlay__btn--primary {
  background: var(--p-primary-color, #6366f1);
  color: white;
}

.todo-overlay__btn--primary:hover:not(:disabled) {
  opacity: 0.9;
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
  background: var(--p-surface-100, #f1f5f9);
  padding: 1px 4px;
  border-radius: 3px;
}

.markdown-content :deep(pre) {
  background: var(--p-surface-100, #f1f5f9);
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
