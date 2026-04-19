<template>
  <Teleport to="body">
    <div v-if="codeServerStore.activeTaskId !== null" class="code-server-overlay">
      <!-- Header bar -->
      <div class="code-server-overlay__header">
        <i class="pi pi-code code-server-overlay__icon" />
        <span class="code-server-overlay__title">
          {{ taskTitle || "Code Editor" }}
        </span>
        <Button
          icon="pi pi-comments"
          text
          rounded
          size="small"
          severity="secondary"
          v-tooltip="'Open chat'"
          class="code-server-overlay__chat-btn"
          @click="openChat"
        />
        <div class="code-server-overlay__actions">
          <Button
            v-if="instance?.status === 'ready'"
            icon="pi pi-stop-circle"
            text
            rounded
            size="small"
            severity="danger"
            v-tooltip="'Stop code-server'"
            @click="stop"
          />
          <Button
            icon="pi pi-times"
            text
            rounded
            size="small"
            severity="secondary"
            v-tooltip="'Close editor'"
            @click="close"
          />
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="!instance || instance.status === 'starting'" class="code-server-overlay__loading">
        <ProgressSpinner style="width: 40px; height: 40px" />
        <span class="code-server-overlay__loading-text">
          {{ instance?.statusText || "Starting code-server…" }}
        </span>
      </div>

      <!-- Error state -->
      <div v-else-if="instance.status === 'error'" class="code-server-overlay__error">
        <i class="pi pi-exclamation-triangle" />
        <span>{{ instance.statusText }}</span>
        <Button label="Retry" size="small" @click="retry" />
      </div>

      <!-- Editor iframe -->
      <iframe
        v-else-if="instance.status === 'ready'"
        :src="`http://127.0.0.1:${instance.port}`"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        class="code-server-overlay__iframe"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import ProgressSpinner from "primevue/progressspinner";
import { useCodeServerStore } from "../stores/codeServer";
import { useTaskStore } from "../stores/task";

const codeServerStore = useCodeServerStore();
const taskStore = useTaskStore();

const instance = computed(() => {
  if (codeServerStore.activeTaskId === null) return null;
  return codeServerStore.instances.get(codeServerStore.activeTaskId) ?? null;
});

const taskTitle = computed(() => {
  if (codeServerStore.activeTaskId === null) return "";
  const allTasks = Object.values(taskStore.tasksByBoard).flat();
  const task = allTasks.find((t) => t.id === codeServerStore.activeTaskId);
  return task?.title ?? "";
});

function openChat() {
  if (codeServerStore.activeTaskId !== null) {
    taskStore.selectTask(codeServerStore.activeTaskId);
  }
}

function close() {
  codeServerStore.closeEditor();
}

async function stop() {
  if (codeServerStore.activeTaskId !== null) {
    await codeServerStore.stopEditor(codeServerStore.activeTaskId);
  }
}

async function retry() {
  if (codeServerStore.activeTaskId === null) return;
  const taskId = codeServerStore.activeTaskId;
  codeServerStore.instances.delete(taskId);
  await codeServerStore.openEditor(taskId);
}
</script>

<style scoped>
.code-server-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 22px; /* leave terminal footer visible */
  z-index: 800;
  background: var(--p-surface-900, #1e1e1e);
  display: flex;
  flex-direction: column;
}

.code-server-overlay__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  background: var(--p-surface-800, #252526);
  border-bottom: 1px solid var(--p-surface-700, #3c3c3c);
  flex-shrink: 0;
  min-height: 40px;
}

.code-server-overlay__icon {
  color: var(--p-primary-color, #4fc3f7);
  font-size: 0.9rem;
}

.code-server-overlay__title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--p-surface-0, #fff);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-server-overlay__chat-btn {
  margin-left: 0.5rem;
}

.code-server-overlay__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.code-server-overlay__loading,
.code-server-overlay__error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--p-surface-300, #ccc);
}

.code-server-overlay__loading-text {
  font-size: 0.9rem;
}

.code-server-overlay__error {
  color: var(--p-red-400, #f87171);
  font-size: 0.9rem;
}

.code-server-overlay__iframe {
  flex: 1;
  width: 100%;
  border: none;
  display: block;
}
</style>
