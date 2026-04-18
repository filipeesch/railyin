<template>
  <Teleport to="body">
      <div v-if="visible" class="task-overlay" @mousedown.stop @keydown.esc="onClose">
      <div class="task-overlay__backdrop" @click="onClose" />
      <div class="task-overlay__panel">
      <div class="task-overlay__header">
        <div class="task-overlay__title">
          <i class="pi pi-tasks" />
          <span>{{ form.title || 'New Task' }}</span>
        </div>
        <div class="task-overlay__header-actions">
          <Button
            v-if="props.taskId != null"
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            aria-label="Delete task"
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

      <!-- Title and Project Fields (editable only in backlog) -->
      <div class="task-overlay__meta">
        <div class="task-overlay__field">
          <label for="task-title">Title</label>
          <InputText
            id="task-title"
            v-model="form.title"
            :disabled="!isBacklog"
            class="w-full"
            :class="{ 'readonly-field': !isBacklog }"
          />
        </div>
        <div class="task-overlay__field">
          <label for="task-project">Project</label>
          <Select
            id="task-project"
            v-model="form.projectKey"
            :options="visibleProjects"
            option-label="name"
            option-value="key"
            :disabled="!isBacklog"
            class="w-full"
            :class="{ 'readonly-field': !isBacklog }"
            placeholder="Select project"
          />
        </div>
      </div>

      <!-- Body with Tabs -->
      <div class="task-overlay__body">
        <div class="task-overlay__toolbar">
          <button
            class="task-overlay__tab"
            :class="{ 'task-overlay__tab--active': !editMode }"
            @click="editMode = false"
          >Preview</button>
          <button
            class="task-overlay__tab"
            :class="{ 'task-overlay__tab--active': editMode }"
            @click="editMode = true"
          >Edit</button>
        </div>

        <div v-if="editMode" class="task-overlay__edit">
          <textarea
            v-model="form.description"
            class="task-overlay__textarea"
            placeholder="Write a rich markdown description — what to do, why, files involved, constraints, acceptance criteria."
          />
        </div>
        <div
          v-else
          class="task-overlay__preview markdown-content"
          v-html="renderedDescription"
        />
      </div>

      <!-- Footer -->
      <div class="task-overlay__footer">
        <span v-if="error" class="task-overlay__error">{{ error }}</span>
        <div class="task-overlay__footer-actions">
          <Button label="Cancel" severity="secondary" @click="onClose" :disabled="saving" />
          <Button
            v-if="isBacklog"
            label="Save"
            severity="primary"
            :loading="saving"
            :disabled="!form.title.trim() || (!props.taskId && !form.projectKey)"
            @click="onSave"
          />
        </div>
      </div>
      </div>
      </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from "vue";
import { marked } from "marked";
import { api } from "../rpc";
import type { Task } from "@shared/rpc-types";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { useProjectStore } from "../stores/project";
import { useWorkspaceStore } from "../stores/workspace";
import { useTaskStore } from "../stores/task";

const props = defineProps<{
  visible: boolean;
  taskId: number | null;
  boardId: number;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  deleted: [];
}>();

const projectStore = useProjectStore();
const workspaceStore = useWorkspaceStore();
const taskStore = useTaskStore();
const editMode = ref(false); // Default to preview mode
const saving = ref(false);
const error = ref<string | null>(null);
const task = ref<Task | null>(null);

const form = reactive({
  title: "",
  description: "",
  projectKey: null as string | null,
  workflowState: "" as string,
});

const visibleProjects = computed(() =>
  projectStore.projects.filter((project) => project.workspaceKey === workspaceStore.activeWorkspaceKey),
);

const isBacklog = computed(() => form.workflowState === "backlog");

const renderedDescription = computed(() => {
  if (!form.description) return "<p><em>No description yet.</em></p>";
  return marked.parse(form.description, { async: false, breaks: true, gfm: true }) as string;
});

async function loadTask() {
  if (props.taskId == null) {
    // New Task Initialization Logic
    task.value = null;
    form.title = "";
    form.description = "";
    form.projectKey = undefined; // Clear project key for new task
    form.workflowState = "backlog"; // Default to backlog state
    editMode.value = true; // Force edit mode on creation
  } else {
    // Existing Task Loading Logic
    try {
      const tasks = await api("tasks.list", {
        boardId: props.boardId,
      });
      const foundTask = tasks.find((t) => t.id === props.taskId);
      if (foundTask) {
        task.value = foundTask;
        form.title = foundTask.title;
        form.description = foundTask.description || "";
        form.projectKey = foundTask.projectKey;
        form.workflowState = foundTask.workflowState;
        editMode.value = false; // Default to preview mode for existing tasks
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load task";
    }
  }
}

async function onSave() {
  if (!form.title.trim()) return;
  saving.value = true;
  error.value = null;
  try {
    if (props.taskId) {
      // Update existing task — go through the store so _replaceTask updates reactive state
      await taskStore.updateTask(props.taskId, form.title.trim(), form.description);
    } else {
      // Create new task
      await api("tasks.create", {
        boardId: props.boardId,
        title: form.title.trim(),
        description: form.description,
        projectKey: form.projectKey || undefined,
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
  if (props.taskId == null) return;
  saving.value = true;
  error.value = null;
  try {
    await api("tasks.delete", { taskId: props.taskId });
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
  () => [props.visible, props.taskId] as const,
  ([visible]) => {
    if (visible) {
      error.value = null;
      projectStore.loadProjects();
      loadTask();
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await projectStore.loadProjects();
});
</script>

<style scoped>
.task-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.task-overlay__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.task-overlay__panel {
  position: relative;
  z-index: 1;
  width: 60vw;
  height: 60vh;
  background: var(--p-surface-0, #fff);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.task-overlay__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.task-overlay__header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* Meta fields (title and project) */
.task-overlay__meta {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
  gap: 12px;
}

.task-overlay__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-overlay__field label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--p-text-muted-color, #64748b);
}

.readonly-field {
  background: var(--p-surface-100, #f1f5f9);
  cursor: not-allowed;
  opacity: 0.7;
}

/* Body */
.task-overlay__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.task-overlay__toolbar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--p-content-border-color);
  flex-shrink: 0;
}

.task-overlay__tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  color: var(--p-text-muted-color);
  margin-bottom: -1px;
}

.task-overlay__tab--active {
  border-bottom-color: var(--p-primary-color);
  color: var(--p-primary-color);
  font-weight: 500;
}

.task-overlay__edit {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.task-overlay__textarea {
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

.task-overlay__textarea:focus {
  outline: none;
}

.task-overlay__preview {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--p-text-color);
}

/* Footer */
.task-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
  gap: 1rem;
}

.task-overlay__error {
  flex: 1;
  font-size: 0.8rem;
  color: var(--p-red-500, #ef4444);
}

.task-overlay__footer-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-left: auto;
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
html.dark-mode .task-overlay__panel {
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .task-overlay__header {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .task-overlay__meta {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .task-overlay__footer {
  border-top-color: var(--p-surface-700, #334155);
}
</style>
