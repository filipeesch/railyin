<template>
  <div class="task-git">
    <div v-if="task.worktreeStatus" class="info-section">
      <div class="info-section__label">Worktree</div>

      <!-- READY state -->
      <template v-if="task.worktreeStatus === 'ready'">
        <div v-if="task.branchName" class="info-meta-row">
          <span class="info-key">Branch</span>
          <span class="info-value info-value--mono">{{ task.branchName }}</span>
        </div>

        <!-- Path row with delete button / inline confirmation -->
        <div v-if="task.worktreePath" class="info-meta-row">
          <template v-if="!confirmingDelete">
            <span class="info-key">Path</span>
            <span class="info-value info-value--mono info-value--break">{{ task.worktreePath }}</span>
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
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import Button from "primevue/button";
import type { Task } from "@shared/rpc-types";
import WorktreeCreateForm from "./WorktreeCreateForm.vue";

const props = defineProps<{
  task: Task;
  branches: string[];
  createLoading: boolean;
  createError: string | null;
  removeLoading: boolean;
  removeWarning: string | null;
  worktreeBasePath: string;
}>();

const emit = defineEmits<{
  createWorktree: [params: { mode: "new" | "existing"; branchName: string; path: string; sourceBranch?: string }];
  removeWorktree: [];
}>();

const confirmingDelete = ref(false);
const retryOpen = ref(false);

watch(() => props.task.worktreeStatus, () => {
  confirmingDelete.value = false;
  retryOpen.value = false;
});

function cancelDelete() {
  confirmingDelete.value = false;
}

function confirmDelete() {
  emit("removeWorktree");
}

function openRetry() {
  retryOpen.value = true;
}

function onCreateWorktree(params: { mode: "new" | "existing"; branchName: string; path: string; sourceBranch?: string }) {
  emit("createWorktree", params);
}
</script>

<style scoped>
.task-git {
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

.delete-confirm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--p-red-400, #f87171);
  border-radius: 8px;
  background: color-mix(in srgb, var(--p-red-400, #f87171) 12%, var(--p-content-background, #fff));
  font-size: 0.82rem;
  max-width: 480px;
}

.delete-confirm__text {
  color: var(--p-text-color);
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

.worktree-create-form {
  margin-top: 4px;
}
</style>
