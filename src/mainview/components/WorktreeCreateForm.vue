<template>
  <div class="wt-create-form">
    <!-- Mode toggle -->
    <div class="wt-mode-toggle">
      <button
        :class="['wt-mode-btn', { 'wt-mode-btn--active': mode === 'new' }]"
        @click="mode = 'new'"
      >New branch</button>
      <button
        :class="['wt-mode-btn', { 'wt-mode-btn--active': mode === 'existing' }]"
        @click="mode = 'existing'"
      >Existing branch</button>
    </div>

    <!-- New branch fields -->
    <template v-if="mode === 'new'">
      <div class="wt-field">
        <label class="wt-label">Branch</label>
        <InputText v-model="newBranchName" size="small" class="wt-input" placeholder="task/id-title" />
      </div>
      <div class="wt-field">
        <label class="wt-label">From</label>
        <Select
          v-model="sourceBranch"
          :options="branches"
          size="small"
          class="wt-input"
          placeholder="Select source branch…"
          :empty-message="branches.length === 0 ? 'No branches found' : 'No results'"
          filter
        />
      </div>
    </template>

    <!-- Existing branch fields -->
    <template v-else>
      <div class="wt-field">
        <label class="wt-label">Branch</label>
        <Select
          v-model="existingBranch"
          :options="branches"
          size="small"
          class="wt-input"
          placeholder="Select branch…"
          :empty-message="branches.length === 0 ? 'No branches found' : 'No results'"
          filter
        />
      </div>
    </template>

    <!-- Path (common) -->
    <div class="wt-field">
      <label class="wt-label">Path</label>
      <InputText v-model="worktreePath" size="small" class="wt-input" placeholder="/path/to/worktree" />
    </div>

    <!-- Error message -->
    <div v-if="createError" class="wt-error">
      <i class="pi pi-exclamation-circle" /> {{ createError }}
    </div>

    <!-- Actions -->
    <div class="wt-actions">
      <Button v-if="showCancel" label="Cancel" text size="small" @click="emit('cancel')" />
      <Button
        label="Create Worktree"
        size="small"
        :loading="createLoading"
        :disabled="!canCreate"
        @click="submit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import type { Task } from "@shared/rpc-types";

const props = defineProps<{
  task: Task;
  branches: string[];
  createLoading: boolean;
  createError: string | null;
  worktreeBasePath: string;
  showCancel?: boolean;
}>();

const emit = defineEmits<{
  create: [params: { mode: "new" | "existing"; branchName: string; path: string; sourceBranch?: string }];
  cancel: [];
}>();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const defaultBranch = computed(() => `task/${props.task.id}-${slugify(props.task.title)}`);
const defaultPath = computed(() => `${props.worktreeBasePath}/${defaultBranch.value}`);

const mode = ref<"new" | "existing">("new");
const newBranchName = ref(defaultBranch.value);
const sourceBranch = ref<string | null>(null);
const existingBranch = ref<string | null>(null);
const worktreePath = ref(defaultPath.value);

// Reset defaults when task changes
watch(() => props.task.id, () => {
  newBranchName.value = defaultBranch.value;
  worktreePath.value = defaultPath.value;
  sourceBranch.value = null;
  existingBranch.value = null;
});

// Auto-select first branch when branches load and nothing selected
watch(() => props.branches, (branches) => {
  if (branches.length > 0 && !sourceBranch.value) {
    sourceBranch.value = branches[0];
  }
}, { immediate: true });

const canCreate = computed(() => {
  if (!worktreePath.value.trim()) return false;
  if (mode.value === "new") return !!newBranchName.value.trim();
  return !!existingBranch.value;
});

function submit() {
  if (!canCreate.value) return;
  if (mode.value === "new") {
    emit("create", {
      mode: "new",
      branchName: newBranchName.value.trim(),
      path: worktreePath.value.trim(),
      sourceBranch: sourceBranch.value ?? undefined,
    });
  } else {
    emit("create", {
      mode: "existing",
      branchName: existingBranch.value!,
      path: worktreePath.value.trim(),
    });
  }
}
</script>

<style scoped>
.wt-create-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 8px;
  background: var(--p-content-background, #fff);
}

.wt-mode-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 2px;
}

.wt-mode-btn {
  flex: 1;
  padding: 4px 10px;
  font-size: 0.78rem;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--p-text-muted-color, #94a3b8);
  transition: background 0.15s, color 0.15s;
}

.wt-mode-btn:hover {
  background: var(--p-content-hover-background);
}

.wt-mode-btn--active {
  background: var(--p-primary-color, #6366f1);
  color: #fff;
}

.wt-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wt-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.wt-input {
  width: 100%;
  font-size: 0.8rem;
}

.wt-input :deep(input) {
  width: 100%;
  font-size: 0.8rem;
  font-family: ui-monospace, "Cascadia Code", monospace;
}

.wt-error {
  font-size: 0.8rem;
  color: var(--p-red-500, #ef4444);
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.wt-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 2px;
}
</style>
