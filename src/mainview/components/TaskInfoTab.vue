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

    <!-- Worktree section — shown whenever worktreeStatus is set -->
    <div v-if="task.worktreeStatus" class="info-section">
      <div class="info-section__label">Worktree</div>

      <!-- READY state -->
      <template v-if="task.worktreeStatus === 'ready'">
        <div v-if="task.branchName" class="info-meta-row">
          <span class="info-key">Branch</span>
          <span class="info-value info-value--mono">{{ task.branchName }}</span>
        </div>

        <!-- Path row with delete button / inline confirmation -->
        <div v-if="task.worktreePath" class="info-meta-row info-meta-row--between">
          <template v-if="!confirmingDelete">
            <div class="info-meta-row">
              <span class="info-key">Path</span>
              <span class="info-value info-value--mono info-value--break">{{ task.worktreePath }}</span>
            </div>
            <Button
              icon="pi pi-trash"
              text
              size="small"
              severity="danger"
              v-tooltip="'Delete worktree'"
              :disabled="task.executionState === 'running' || removeLoading"
              @click="confirmingDelete = true"
            />
          </template>
          <template v-else>
            <div class="delete-confirm">
              <span class="delete-confirm__text">
                Delete worktree at <code>{{ task.worktreePath }}</code>?
                The task and branch will be kept.
              </span>
              <div v-if="removeWarning" class="delete-confirm__warning">
                <i class="pi pi-exclamation-triangle" /> {{ removeWarning }}
              </div>
              <div class="delete-confirm__actions">
                <Button label="Cancel" text size="small" @click="cancelDelete" />
                <Button
                  label="Delete"
                  severity="danger"
                  size="small"
                  :loading="removeLoading"
                  :disabled="!!removeWarning"
                  @click="confirmDelete"
                />
              </div>
            </div>
          </template>
        </div>

        <div class="info-meta-row">
          <span class="info-key">Status</span>
          <span class="info-value">ready</span>
        </div>
      </template>

      <!-- CREATING state -->
      <template v-else-if="task.worktreeStatus === 'creating'">
        <div class="info-meta-row">
          <i class="pi pi-spin pi-spinner" style="font-size: 0.85rem" />
          <span class="info-value info-value--muted" style="margin-left: 6px">Creating worktree…</span>
        </div>
      </template>

      <!-- ERROR state -->
      <template v-else-if="task.worktreeStatus === 'error'">
        <div class="info-meta-row">
          <span class="info-key">Status</span>
          <span class="info-value info-value--danger">error</span>
        </div>
        <div v-if="!retryOpen" class="info-meta-row">
          <Button label="Retry" size="small" severity="secondary" @click="openRetry" />
        </div>
        <div v-else class="worktree-create-form">
          <WorktreeCreateForm
            :task="task"
            :branches="branches"
            :create-loading="createLoading"
            :create-error="createError"
            :worktree-base-path="worktreeBasePath"
            @create="onCreateWorktree"
            @cancel="retryOpen = false"
          />
        </div>
      </template>

      <!-- NOT_CREATED / REMOVED state -->
      <template v-else-if="task.worktreeStatus === 'not_created' || task.worktreeStatus === 'removed'">
        <div class="info-meta-row">
          <span class="info-key">Status</span>
          <span class="info-value info-value--muted">{{ task.worktreeStatus === 'removed' ? 'removed' : 'not created' }}</span>
        </div>
        <div v-if="task.executionState !== 'running'" class="worktree-create-form">
          <WorktreeCreateForm
            :task="task"
            :branches="branches"
            :create-loading="createLoading"
            :create-error="createError"
            :worktree-base-path="worktreeBasePath"
            @create="onCreateWorktree"
          />
        </div>
      </template>

      <!-- fallback for any other status -->
      <template v-else>
        <div v-if="task.branchName" class="info-meta-row">
          <span class="info-key">Branch</span>
          <span class="info-value info-value--mono">{{ task.branchName }}</span>
        </div>
        <div v-if="task.worktreePath" class="info-meta-row">
          <span class="info-key">Path</span>
          <span class="info-value info-value--mono info-value--break">{{ task.worktreePath }}</span>
        </div>
        <div class="info-meta-row">
          <span class="info-key">Status</span>
          <span class="info-value">{{ task.worktreeStatus }}</span>
        </div>
      </template>
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
import { computed, ref, watch } from "vue";
import { marked } from "marked";
import Button from "primevue/button";
import type { Task, Board } from "@shared/rpc-types";
import WorktreeCreateForm from "./WorktreeCreateForm.vue";

const props = defineProps<{
  task: Task;
  board: Board | null;
  branches: string[];
  createLoading: boolean;
  createError: string | null;
  removeLoading: boolean;
  removeWarning: string | null;
  worktreeBasePath: string;
}>();

const emit = defineEmits<{
  edit: [];
  createWorktree: [params: { mode: "new" | "existing"; branchName: string; path: string; sourceBranch?: string }];
  removeWorktree: [];
}>();

const confirmingDelete = ref(false);
const retryOpen = ref(false);

// Reset confirmation state when task status changes (e.g., WS update after delete)
watch(() => props.task.worktreeStatus, () => {
  confirmingDelete.value = false;
  retryOpen.value = false;
});

// Reset createError visibility when status changes to not_created/removed (new form)
watch(() => props.task.worktreeStatus, (status) => {
  if (status === "not_created" || status === "removed") {
    retryOpen.value = false;
  }
});

function cancelDelete() {
  confirmingDelete.value = false;
}

async function confirmDelete() {
  emit("removeWorktree");
}

function openRetry() {
  retryOpen.value = true;
}

function onCreateWorktree(params: { mode: "new" | "existing"; branchName: string; path: string; sourceBranch?: string }) {
  emit("createWorktree", params);
}

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

.info-meta-row--between {
  justify-content: space-between;
  align-items: center;
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

.info-value--danger {
  color: var(--p-red-500, #ef4444);
}

.info-value--mono {
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 0.78rem;
}

.info-value--break {
  word-break: break-all;
}

/* Delete confirmation */
.delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--p-red-200, #fecaca);
  border-radius: 8px;
  background: var(--p-red-50, #fff5f5);
  font-size: 0.82rem;
}

.delete-confirm__text {
  color: var(--p-text-color, #1e293b);
  line-height: 1.5;
}

.delete-confirm__text code {
  font-family: ui-monospace, monospace;
  font-size: 0.78em;
  word-break: break-all;
}

.delete-confirm__warning {
  color: var(--p-orange-600, #ea580c);
  font-size: 0.8rem;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.delete-confirm__actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

/* Create form wrapper */
.worktree-create-form {
  margin-top: 4px;
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
