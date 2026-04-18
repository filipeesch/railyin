<template>
  <div class="task-info">
    <!-- Project section -->
    <div v-if="board" class="info-section">
      <div class="info-section__label">Project</div>
      <div class="info-meta-row">
        <span class="info-value">{{ board.name }}</span>
        <span class="info-sep">·</span>
        <span class="info-value info-value--muted">{{ task.projectKey }}</span>
      </div>
    </div>

    <!-- Worktree section -->
    <div v-if="hasWorktreeInfo" class="info-section">
      <div class="info-section__label">Worktree</div>
      <div v-if="task.branchName" class="info-meta-row">
        <span class="info-key">Branch</span>
        <span class="info-value info-value--mono">{{ task.branchName }}</span>
      </div>
      <div v-if="task.worktreePath" class="info-meta-row">
        <span class="info-key">Path</span>
        <span class="info-value info-value--mono info-value--break">{{ task.worktreePath }}</span>
      </div>
      <div v-if="task.worktreeStatus" class="info-meta-row">
        <span class="info-key">Status</span>
        <span class="info-value">{{ task.worktreeStatus }}</span>
      </div>
    </div>

    <!-- Description section -->
    <div class="info-section info-section--description">
      <div class="info-section__heading-row">
        <span class="info-section__label">Description</span>
        <Button
          icon="pi pi-pencil"
          text
          size="small"
          v-tooltip="'Edit title & description'"
          @click="emit('edit')"
        />
      </div>
      <div
        class="info-description prose"
        v-html="renderedDescription"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import Button from "primevue/button";
import type { Task, Board } from "@shared/rpc-types";

const props = defineProps<{
  task: Task;
  board: Board | null;
}>();

const emit = defineEmits<{
  edit: [];
}>();

const hasWorktreeInfo = computed(() =>
  !!(props.task.branchName || props.task.worktreePath || props.task.worktreeStatus)
);

const renderedDescription = computed(() => {
  if (!props.task.description?.trim()) return '<p class="info-description--empty">No description.</p>';
  return marked.parse(props.task.description, { async: false, breaks: true, gfm: true }) as string;
});
</script>

<style scoped>
.task-info {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-section__label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.info-section__heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.info-meta-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.info-key {
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
  min-width: 56px;
  flex-shrink: 0;
}

.info-sep {
  color: var(--p-text-muted-color, #94a3b8);
}

.info-value {
  font-size: 0.85rem;
  color: var(--p-text-color, #1e293b);
  min-width: 0;
}

.info-value--muted {
  color: var(--p-text-muted-color, #94a3b8);
}

.info-value--mono {
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 0.78rem;
}

.info-value--break {
  word-break: break-all;
}

.info-description {
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 8px;
  padding: 12px 14px;
  min-height: 60px;
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--p-text-color, #1e293b);
  background: var(--p-content-background, #fff);
}

.info-description :deep(.info-description--empty) {
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
  margin: 0;
}

/* Prose styles for rendered markdown */
.info-description :deep(p) { margin: 0 0 0.6em; }
.info-description :deep(p:last-child) { margin-bottom: 0; }
.info-description :deep(h1),
.info-description :deep(h2),
.info-description :deep(h3),
.info-description :deep(h4) {
  font-weight: 600;
  margin: 0.8em 0 0.3em;
  line-height: 1.3;
}
.info-description :deep(ul),
.info-description :deep(ol) {
  margin: 0.4em 0 0.6em 1.4em;
  padding: 0;
}
.info-description :deep(li) { margin: 0.15em 0; }
.info-description :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.82em;
  background: var(--p-content-hover-background);
  border-radius: 4px;
  padding: 1px 5px;
}
.info-description :deep(pre) {
  background: var(--p-surface-900, #0f172a);
  color: var(--p-surface-100, #f1f5f9);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.8rem;
}
.info-description :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}
</style>
