<template>
  <div class="setup-section">
    <div class="boards-header">
      <h3>Workflows</h3>
      <Button
        label="Add workflow"
        icon="pi pi-plus"
        size="small"
        severity="secondary"
        outlined
        @click="openAddWorkflow"
      />
    </div>

    <div v-if="workflowStore.workflows.length === 0" class="setup-hint">
      No workflows yet. Add one to get started.
    </div>

    <div v-else class="project-list">
      <div v-for="wf in workflowStore.workflows" :key="wf.id" class="project-item">
        <i class="pi pi-sitemap project-item__icon" />
        <div class="project-item__info">
          <span class="project-item__name">{{ wf.name }}</span>
          <span class="project-item__path">{{ wf.id }}</span>
        </div>
        <div class="project-item__actions">
          <Button
            icon="pi pi-pencil"
            severity="secondary"
            text
            size="small"
            aria-label="Edit workflow"
            title="Edit workflow"
            @click="openEditWorkflow(wf)"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            size="small"
            aria-label="Delete workflow"
            :disabled="!wf.deletable"
            :title="wf.deletable ? 'Delete workflow' : (wf.undeletableReason ?? 'Cannot delete workflow')"
            @click="onDeleteWorkflow(wf)"
          />
        </div>
      </div>
    </div>
  </div>

  <WorkflowEditorOverlay
    v-if="editor.templateId"
    :visible="editor.visible"
    :workspace-key="workspaceStore.activeWorkspaceKey ?? undefined"
    :template-id="editor.templateId"
    :template-name="editor.templateName"
    :initial-yaml="editor.yaml"
    @close="editor.visible = false"
    @saved="onWorkflowSaved"
  />

  <Dialog
    v-model:visible="addVisible"
    header="Add Workflow"
    :modal="true"
    :style="{ width: '400px' }"
  >
    <div class="field">
      <label>Name</label>
      <InputText v-model="newName" placeholder="My Workflow" class="w-full" @keyup.enter="doAddWorkflow" />
    </div>
    <Message v-if="addError" severity="error" :closable="false" class="mt-2">{{ addError }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="addVisible = false" :disabled="addInProgress" />
      <Button
        label="Create workflow"
        icon="pi pi-check"
        :loading="addInProgress"
        :disabled="!newName.trim()"
        @click="doAddWorkflow"
      />
    </template>
  </Dialog>

  <Dialog
    v-model:visible="deleteConfirmVisible"
    header="Delete Workflow"
    :modal="true"
    :style="{ width: '420px' }"
  >
    <p v-if="deletingWorkflow" style="line-height: 1.6">
      Delete <strong>{{ deletingWorkflow.name }}</strong>? This cannot be undone.
    </p>
    <Message v-if="deleteError" severity="error" :closable="false" class="mt-2">{{ deleteError }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="deleteConfirmVisible = false" :disabled="deleteInProgress" />
      <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deleteInProgress" @click="doDeleteWorkflow" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import InputText from "primevue/inputtext";
import { useWorkflowStore } from "../stores/workflow";
import { useWorkspaceStore } from "../stores/workspace";
import { api, onWorkflowReloaded } from "../rpc";
import type { WorkflowSummary } from "@shared/rpc-types";
import WorkflowEditorOverlay from "./WorkflowEditorOverlay.vue";

const workflowStore = useWorkflowStore();
const workspaceStore = useWorkspaceStore();

function refresh() {
  return workflowStore.loadWorkflows(workspaceStore.activeWorkspaceKey ?? undefined);
}

// Re-fetch the list when the backend signals a workflow file changed.
onWorkflowReloaded(() => { void refresh(); });

// ── Editor overlay ────────────────────────────────────────────────────────────
const editor = ref({ visible: false, templateId: "", templateName: "", yaml: "" });

async function openEditWorkflow(wf: WorkflowSummary) {
  try {
    const { yaml } = await api("workflow.getYaml", {
      workspaceKey: workspaceStore.activeWorkspaceKey ?? undefined,
      templateId: wf.id,
    });
    editor.value = { visible: true, templateId: wf.id, templateName: wf.name, yaml };
  } catch (e) {
    console.error("[workflow] Failed to load YAML:", e);
  }
}

async function onWorkflowSaved() {
  await refresh();
}

// ── Add workflow ──────────────────────────────────────────────────────────────
const addVisible = ref(false);
const newName = ref("");
const addInProgress = ref(false);
const addError = ref<string | null>(null);

function openAddWorkflow() {
  newName.value = "";
  addError.value = null;
  addVisible.value = true;
}

async function doAddWorkflow() {
  const name = newName.value.trim();
  if (!name || addInProgress.value) return;
  addInProgress.value = true;
  addError.value = null;
  try {
    await api("workflow.create", {
      workspaceKey: workspaceStore.activeWorkspaceKey ?? undefined,
      name,
    });
    addVisible.value = false;
    await refresh();
  } catch (e) {
    addError.value = e instanceof Error ? e.message : String(e);
  } finally {
    addInProgress.value = false;
  }
}

// ── Delete workflow ───────────────────────────────────────────────────────────
const deleteConfirmVisible = ref(false);
const deletingWorkflow = ref<WorkflowSummary | null>(null);
const deleteInProgress = ref(false);
const deleteError = ref<string | null>(null);

function onDeleteWorkflow(wf: WorkflowSummary) {
  if (!wf.deletable) return;
  deletingWorkflow.value = wf;
  deleteError.value = null;
  deleteConfirmVisible.value = true;
}

async function doDeleteWorkflow() {
  if (!deletingWorkflow.value) return;
  deleteInProgress.value = true;
  deleteError.value = null;
  try {
    await api("workflow.delete", {
      workspaceKey: workspaceStore.activeWorkspaceKey ?? undefined,
      templateId: deletingWorkflow.value.id,
    });
    deleteConfirmVisible.value = false;
    deletingWorkflow.value = null;
    await refresh();
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : String(e);
  } finally {
    deleteInProgress.value = false;
  }
}

defineExpose({ refresh });
</script>

<style scoped>
.setup-section { padding: 8px 0; }

.boards-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.boards-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.setup-hint {
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  margin: 0 0 16px;
}

.project-list {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--p-surface-100, #f1f5f9);
  font-size: 0.88rem;
}

.project-item:last-child { border-bottom: none; }

.project-item__icon { color: var(--p-text-muted-color, #94a3b8); flex-shrink: 0; }

.project-item__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.project-item__name { font-weight: 500; }

.project-item__path {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-item__actions { display: flex; gap: 2px; flex-shrink: 0; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field label { font-size: 0.85rem; font-weight: 500; }
.w-full { width: 100%; }
.mt-2 { margin-top: 8px; }
</style>
