<template>
  <div class="setup-view">
    <div class="setup-card">
      <div class="setup-card__logo">
        <span class="logo-mark">R</span>
        <span class="logo-text">Railyn</span>
      </div>

      <div class="setup-workspace-header">
        <div v-if="workspaceStore.workspaces.length > 0" class="setup-workspace-picker">
          <span class="setup-workspace-picker__label">Workspace</span>
          <Select
            :modelValue="workspaceStore.activeWorkspaceKey"
            :options="workspaceStore.workspaces"
            option-label="name"
            option-value="key"
            class="setup-workspace-picker__select"
            @update:modelValue="onWorkspaceSelected"
          />
        </div>
        <Button
          icon="pi pi-plus"
          label="New workspace"
          severity="secondary"
          outlined
          size="small"
          @click="showNewWorkspace = true"
        />
      </div>

      <Message v-if="workspaceStore.error" severity="error" :closable="false" class="mb-3">
        {{ workspaceStore.error }}
      </Message>

      <div class="setup-header-actions">
        <Button
          v-if="hasAnyBoards"
          label="Go to board"
          icon="pi pi-arrow-right"
          icon-pos="right"
          @click="goToBoard"
        />
      </div>

      <TabView v-model:activeIndex="activeTab">

        <TabPanel header="Workspace">
          <div class="setup-section">
            <div class="field">
              <label>Workspace name</label>
              <InputText v-model="wsForm.name" placeholder="My Workspace" class="w-full" />
            </div>
            <div class="field">
              <label>Engine</label>
              <Select
                v-model="wsForm.engineType"
                :options="engineOptions"
                option-label="label"
                option-value="value"
                class="w-full"
                @change="onEngineTypeChange"
              />
            </div>
            <div class="field">
              <label>Default model <span class="field-hint">(optional)</span></label>
              <Select
                v-model="wsForm.engineModel"
                :options="groupedModels"
                option-group-label="label"
                option-group-children="items"
                option-label="label"
                option-value="id"
                :placeholder="modelsLoading ? 'Loading models…' : 'Engine default'"
                :loading="modelsLoading"
                filter
                filter-placeholder="Search models…"
                class="w-full"
                show-clear
              >
                <template #value="{ value, placeholder }">
                  <span v-if="selectedModelOption" :title="selectedModelOption.description ?? selectedModelOption.id ?? undefined">
                    {{ selectedModelOption.label }}
                  </span>
                  <span v-else class="p-select-label p-placeholder">{{ placeholder }}</span>
                </template>
                <template #option="{ option }">
                  <div class="model-select__option" :title="option.description ?? option.id ?? undefined">
                    <div class="model-select__option-title">{{ option.label }}</div>
                    <div v-if="option.description" class="model-select__option-description">{{ option.description }}</div>
                    <div v-if="option.id" class="model-select__option-id">{{ option.id }}</div>
                  </div>
                </template>
              </Select>
              <small v-if="modelsError" class="field-error">{{ modelsError }}</small>
            </div>
            <div class="field">
              <label>Workspace path <span class="field-hint">(root folder containing all projects)</span></label>
              <div class="path-row">
                <InputText v-model="wsForm.workspacePath" placeholder="/home/user/projects" class="w-full" />
                <Button
                  icon="pi pi-folder-open"
                  severity="secondary"
                  outlined
                  :loading="browsingWorkspacePath"
                  aria-label="Browse folder"
                  title="Browse for workspace root folder"
                  @click="browseWorkspacePath"
                />
              </div>
              <small class="field-hint">All project paths must be relative to this folder.</small>
            </div>
            <div class="field">
              <label>Worktree base path <span class="field-hint">(where git worktrees are created)</span></label>
              <div class="path-row">
                <InputText v-model="wsForm.worktreeBasePath" placeholder="~/.railyn/worktrees" class="w-full" />
                <Button
                  icon="pi pi-folder-open"
                  severity="secondary"
                  outlined
                  :loading="browsingWorktreePath"
                  aria-label="Browse folder"
                  title="Browse for worktree base folder"
                  @click="browseWorktreePath"
                />
              </div>
            </div>
            <Message v-if="wsSaveError" severity="error" :closable="false" class="mb-2">{{ wsSaveError }}</Message>
            <Message v-if="wsSaveSuccess" severity="success" :closable="false" class="mb-2">Settings saved</Message>
            <Button label="Save settings" icon="pi pi-save" :loading="wsSaving" @click="saveWorkspaceSettings" />
          </div>
        </TabPanel>

        <TabPanel header="Projects">
          <div class="setup-section">
            <div v-if="visibleProjects.length" class="project-list mb-4">
              <div v-for="p in visibleProjects" :key="p.key" class="project-item">
                <i class="pi pi-folder project-item__icon" />
                <div class="project-item__info">
                  <span class="project-item__name">{{ p.name }}</span>
                  <code class="project-item__path">{{ p.projectPath.relative }}</code>
                </div>
                <div class="project-item__actions">
                  <Button icon="pi pi-pencil" severity="secondary" text rounded size="small" aria-label="Edit project" @click="openEditProject(p)" />
                  <Button icon="pi pi-trash" severity="danger" text rounded size="small" aria-label="Delete project" @click="confirmDeleteProject(p)" />
                </div>
              </div>
            </div>
            <div class="add-project-row">
              <Button label="Add project" icon="pi pi-plus" severity="secondary" outlined @click="openAddProject" />
            </div>
            <LspSetupPrompt
              v-if="showLspPrompt"
              :detected-languages="lspLanguages"
              :project-path="lastRegisteredPath"
            />
          </div>
        </TabPanel>

        <TabPanel header="Boards">
          <div class="setup-section">
            <h3>Create a Board</h3>
            <div class="field">
              <label>Board name</label>
              <InputText v-model="boardName" placeholder="Q2 Delivery" class="w-full" />
            </div>
            <div class="field">
              <label>Workflow</label>
              <select :key="workflowOptionsKey" v-model="boardWorkflowTemplateId" class="setup-native-select">
                <option disabled value="">Select workflow</option>
                <option v-for="workflow in workflowOptions" :key="workflow.value" :value="workflow.value">{{ workflow.label }}</option>
              </select>
            </div>
            <Message v-if="boardError" severity="error" :closable="false">{{ boardError }}</Message>
            <Button
              label="Create board"
              icon="pi pi-plus"
              :loading="boardSaving"
              :disabled="!boardName.trim() || !boardWorkflowTemplateId"
              class="mb-4"
              @click="createBoard"
            />
            <div v-if="visibleBoards.length" class="project-list mt-4">
              <div v-for="b in visibleBoards" :key="b.id" class="project-item">
                <i class="pi pi-table" />
                <span>{{ b.name }}</span>
              </div>
            </div>
          </div>
        </TabPanel>

        <TabPanel header="Models">
          <div class="setup-section">
            <h3>Enabled Models</h3>
            <p class="setup-hint">Choose which models appear in the chat dropdown.</p>
            <ModelTreeView />
          </div>
        </TabPanel>

      </TabView>
    </div>
  </div>

  <ProjectDetailDialog
    v-if="projectDialogVisible"
    v-model="projectDialogVisible"
    ref="projectDialogRef"
    :workspace-key="workspaceStore.activeWorkspaceKey ?? 'default'"
    :project="editingProject ?? undefined"
    @save="onProjectSave"
    @close="projectDialogVisible = false"
  />

  <Dialog v-model:visible="showNewWorkspace" header="New Workspace" :modal="true" :style="{ width: '400px' }">
    <div class="field">
      <label>Name</label>
      <InputText v-model="newWsName" placeholder="My Team" class="w-full" />
    </div>
    <div v-if="newWsName.trim()" class="new-ws-key-preview">Folder key: <code>{{ derivedWsKey }}</code></div>
    <Message v-if="newWsError" severity="error" :closable="false" class="mt-2">{{ newWsError }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="showNewWorkspace = false" :disabled="newWsCreating" />
      <Button
        label="Create workspace"
        icon="pi pi-check"
        :loading="newWsCreating"
        :disabled="!newWsName.trim()"
        @click="createWorkspace"
      />
    </template>
  </Dialog>

  <Dialog v-model:visible="deleteConfirmVisible" header="Delete Project" :modal="true" :style="{ width: '420px' }">
    <p v-if="deletingProject" style="line-height:1.6">
      Delete <strong>{{ deletingProject.name }}</strong>?
      <span v-if="deletingProjectTaskCount > 0">
        This will permanently delete <strong>{{ deletingProjectTaskCount }} task{{ deletingProjectTaskCount !== 1 ? 's' : '' }}</strong> and all their history.
      </span>
      This cannot be undone.
    </p>
    <Message v-if="deleteError" severity="error" :closable="false" class="mt-2">{{ deleteError }}</Message>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="deleteConfirmVisible = false" :disabled="deleteInProgress" />
      <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deleteInProgress" @click="doDeleteProject" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import TabView from "primevue/tabview";
import TabPanel from "primevue/tabpanel";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Button from "primevue/button";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import { api } from "../rpc";
import { useWorkspaceStore } from "../stores/workspace";
import { useBoardStore } from "../stores/board";
import { useProjectStore } from "../stores/project";
import { useTaskStore } from "../stores/task";
import ModelTreeView from "../components/ModelTreeView.vue";
import LspSetupPrompt from "../components/LspSetupPrompt.vue";
import ProjectDetailDialog from "../components/ProjectDetailDialog.vue";
import type { LspDetectedLanguage, ModelInfo, Project, WorkflowTemplate } from "../../shared/rpc-types";

const router = useRouter();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const projectStore = useProjectStore();
const taskStore = useTaskStore();

const activeTab = ref(0);

// ── Workspace settings form ──────────────────────────────────────────────────
const wsForm = reactive({
  name: "",
  engineType: "copilot" as "copilot" | "claude",
  engineModel: null as string | null,
  worktreeBasePath: "",
  workspacePath: "",
});
const wsSaving = ref(false);
const wsSaveError = ref<string | null>(null);
const wsSaveSuccess = ref(false);

const engineOptions = [
  { label: "GitHub Copilot", value: "copilot" },
  { label: "Claude Code", value: "claude" },
];

const modelsLoading = ref(false);
const modelsError = ref<string | null>(null);
const allModelsFlat = ref<ModelInfo[]>([]);

const groupedModels = computed(() => {
  const groups: Record<string, Array<{ id: string | null; label: string; description?: string; contextWindow: number | null }>> = {};
  for (const model of allModelsFlat.value) {
    const provider = model.id == null
      ? "default"
      : (model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : "other");
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push({
      id: model.id,
      label: model.displayName ?? model.id ?? "Auto",
      description: undefined,
      contextWindow: model.contextWindow,
    });
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
});

const selectedModelOption = computed(() => {
  for (const group of groupedModels.value) {
    const found = group.items.find((item) => item.id === wsForm.engineModel);
    if (found) return found;
  }
  return null;
});

const browsingWorktreePath = ref(false);
const browsingWorkspacePath = ref(false);

async function loadModelsForEngine() {
  modelsLoading.value = true;
  modelsError.value = null;
  try {
    const providerLists = await api("models.list", { workspaceKey: workspaceStore.activeWorkspaceKey ?? undefined });
    allModelsFlat.value = providerLists.flatMap((p) =>
      p.models.map((m): ModelInfo => ({ id: m.id, displayName: m.displayName ?? m.id, contextWindow: m.contextWindow })),
    );
  } catch (e) {
    modelsError.value = e instanceof Error ? e.message : "Could not load models";
    allModelsFlat.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

function syncWsForm() {
  const cfg = workspaceStore.config;
  if (!cfg) return;
  wsForm.name = cfg.name ?? "";
  wsForm.engineType = (cfg.engine?.type ?? "copilot") as "copilot" | "claude";
  wsForm.engineModel = cfg.engine?.model ?? null;
  wsForm.worktreeBasePath = cfg.worktreeBasePath ?? "";
  wsForm.workspacePath = cfg.workspacePath ?? "";
}

async function onEngineTypeChange() {
  wsForm.engineModel = null;
  await loadModelsForEngine();
}

async function browseWorkspacePath() {
  browsingWorkspacePath.value = true;
  try {
    const { path } = await api("workspace.openFolderDialog", { initialPath: wsForm.workspacePath || undefined });
    if (path) wsForm.workspacePath = path;
  } finally {
    browsingWorkspacePath.value = false;
  }
}

async function browseWorktreePath() {
  browsingWorktreePath.value = true;
  try {
    const { path } = await api("workspace.openFolderDialog", { initialPath: wsForm.worktreeBasePath || undefined });
    if (path) wsForm.worktreeBasePath = path;
  } finally {
    browsingWorktreePath.value = false;
  }
}

async function saveWorkspaceSettings() {
  wsSaving.value = true;
  wsSaveError.value = null;
  wsSaveSuccess.value = false;
  try {
    await workspaceStore.update({
      name: wsForm.name || undefined,
      engineType: wsForm.engineType,
      engineModel: wsForm.engineModel ?? undefined,
      worktreeBasePath: wsForm.worktreeBasePath || undefined,
      workspacePath: wsForm.workspacePath || undefined,
    });
    wsSaveSuccess.value = true;
    setTimeout(() => { wsSaveSuccess.value = false; }, 3000);
  } catch (e) {
    wsSaveError.value = e instanceof Error ? e.message : String(e);
  } finally {
    wsSaving.value = false;
  }
}

// ── New workspace dialog ─────────────────────────────────────────────────────
const showNewWorkspace = ref(false);
const newWsName = ref("");
const newWsCreating = ref(false);
const newWsError = ref<string | null>(null);

const derivedWsKey = computed(() =>
  newWsName.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "",
);

async function createWorkspace() {
  newWsError.value = null;
  newWsCreating.value = true;
  try {
    await workspaceStore.create(newWsName.value.trim());
    showNewWorkspace.value = false;
    newWsName.value = "";
    activeTab.value = 0;
  } catch (e) {
    newWsError.value = e instanceof Error ? e.message : String(e);
  } finally {
    newWsCreating.value = false;
  }
}

// ── Project dialog ───────────────────────────────────────────────────────────
const projectDialogVisible = ref(false);
const editingProject = ref<Project | null>(null);
const projectDialogRef = ref<InstanceType<typeof ProjectDetailDialog> | null>(null);
const lspLanguages = ref<LspDetectedLanguage[]>([]);
const lastRegisteredPath = ref("");
const showLspPrompt = ref(false);

function openAddProject() {
  editingProject.value = null;
  projectDialogVisible.value = true;
}

function openEditProject(p: Project) {
  editingProject.value = p;
  projectDialogVisible.value = true;
}

async function onProjectSave(data: {
  name: string;
  projectPath: string;
  gitRootPath: string;
  defaultBranch: string;
  slug?: string;
  description?: string;
}) {
  const dialog = projectDialogRef.value;
  dialog?.setSaving(true);
  try {
    if (editingProject.value) {
      await projectStore.updateProject({
        workspaceKey: workspaceStore.activeWorkspaceKey ?? "default",
        key: editingProject.value.key,
        ...data,
      });
      projectDialogVisible.value = false;
    } else {
      const registeredProject = await projectStore.registerProject({
        workspaceKey: workspaceStore.activeWorkspaceKey ?? "default",
        ...data,
      });
      projectDialogVisible.value = false;
      try {
        const detected = await api("lsp.detectLanguages", { projectPath: registeredProject.projectPath.absolute });
        if (detected.length > 0) {
          lastRegisteredPath.value = registeredProject.projectPath.absolute;
          lspLanguages.value = detected;
          showLspPrompt.value = true;
          return;
        }
      } catch { /* non-fatal */ }
      if (!visibleBoards.value.length) activeTab.value = 2;
    }
  } catch (e) {
    dialog?.setSaveError(e instanceof Error ? e.message : String(e));
  } finally {
    dialog?.setSaving(false);
  }
}

// ── Delete project ───────────────────────────────────────────────────────────
const deleteConfirmVisible = ref(false);
const deletingProject = ref<Project | null>(null);
const deletingProjectTaskCount = ref(0);
const deleteInProgress = ref(false);
const deleteError = ref<string | null>(null);

function confirmDeleteProject(p: Project) {
  deletingProject.value = p;
  deleteError.value = null;
  // Count tasks for this project across all boards
  const allTasks = Object.values(taskStore.tasksByBoard).flat();
  deletingProjectTaskCount.value = allTasks.filter((t) => t.projectKey === p.key).length;
  deleteConfirmVisible.value = true;
}

async function doDeleteProject() {
  if (!deletingProject.value) return;
  deleteInProgress.value = true;
  deleteError.value = null;
  try {
    await projectStore.deleteProject(
      workspaceStore.activeWorkspaceKey ?? "default",
      deletingProject.value.key,
    );
    deleteConfirmVisible.value = false;
    deletingProject.value = null;
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : String(e);
  } finally {
    deleteInProgress.value = false;
  }
}

// ── Board form ───────────────────────────────────────────────────────────────
const boardName = ref("");
const boardWorkflowTemplateId = ref("");
const boardSaving = ref(false);
const boardError = ref<string | null>(null);
const workflowOptions = ref<Array<{ label: string; value: string }>>([]);
const workflowOptionsKey = computed(() =>
  `${workspaceStore.activeWorkspaceKey ?? "none"}:${workflowOptions.value.map((entry) => entry.value).join(",")}`,
);
const hasAnyBoards = computed(() => boardStore.boards.length > 0);

const visibleProjects = computed(() =>
  projectStore.projects.filter((project) => project.workspaceKey === workspaceStore.activeWorkspaceKey),
);
const visibleBoards = computed(() =>
  boardStore.boards.filter((board) => board.workspaceKey === workspaceStore.activeWorkspaceKey),
);

onMounted(async () => {
  await workspaceStore.loadWorkspaces();
  await Promise.all([projectStore.loadProjects(), boardStore.loadBoards(), workspaceStore.load()]);
  await loadWorkflowOptions(workspaceStore.activeWorkspaceKey);
  await loadModelsForEngine();
  syncWsForm();
  if (!visibleProjects.value.length) activeTab.value = 1;
  else if (!visibleBoards.value.length) activeTab.value = 2;
});

watch(() => workspaceStore.config, () => { syncWsForm(); });

function setWorkflowOptions(workflows: WorkflowTemplate[]) {
  workflowOptions.value = workflows.map((w) => ({ label: w.name, value: w.id }));
  if (!workflowOptions.value.length) { boardWorkflowTemplateId.value = ""; return; }
  if (!workflowOptions.value.some((w) => w.value === boardWorkflowTemplateId.value)) {
    boardWorkflowTemplateId.value = workflowOptions.value[0]!.value;
  }
}

async function loadWorkflowOptions(workspaceKey: string | null) {
  boardWorkflowTemplateId.value = "";
  if (workspaceKey == null) { workflowOptions.value = []; return; }
  const config = await api("workspace.getConfig", { workspaceKey });
  setWorkflowOptions(config.workflows);
}

watch(
  () => workspaceStore.activeWorkspaceKey,
  async (workspaceKey) => {
    await loadWorkflowOptions(workspaceKey);
    await loadModelsForEngine();
    syncWsForm();
  },
  { immediate: true },
);

async function createBoard() {
  boardError.value = null;
  boardSaving.value = true;
  try {
    if (!boardWorkflowTemplateId.value) throw new Error("Select a workflow template");
    await boardStore.createBoard(
      workspaceStore.activeWorkspaceKey ?? "default",
      boardName.value.trim(),
      boardWorkflowTemplateId.value,
    );
    boardName.value = "";
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  } finally {
    boardSaving.value = false;
  }
}

async function onWorkspaceSelected(workspaceKey: string) {
  await workspaceStore.selectWorkspace(workspaceKey);
  await loadWorkflowOptions(workspaceStore.activeWorkspaceKey);
}

async function goToBoard() {
  if (!boardStore.activeBoardId) {
    const board = boardStore.boards.find((b) => b.workspaceKey === workspaceStore.activeWorkspaceKey)
      ?? boardStore.boards[0];
    if (board) {
      if (board.workspaceKey !== workspaceStore.activeWorkspaceKey) {
        await workspaceStore.selectWorkspace(board.workspaceKey);
      }
      boardStore.selectBoard(board.id);
    }
  }
  router.push("/board");
}
</script>

<style scoped>
.setup-view {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-surface-50, #f8fafc);
  padding: 24px;
  overflow-y: auto;
}
.setup-card {
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 14px;
  padding: 32px;
  width: 100%;
  max-width: 600px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.07);
}
.setup-card__logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
.logo-mark {
  width: 36px; height: 36px;
  background: var(--p-primary-color, #6366f1); color: #fff;
  border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 1.1rem;
}
.logo-text { font-size: 1.3rem; font-weight: 700; color: var(--p-text-color, #1e293b); }
.setup-workspace-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.setup-workspace-picker { display: flex; align-items: center; gap: 8px; flex: 1; }
.setup-workspace-picker__label { font-size: 0.85rem; font-weight: 500; white-space: nowrap; }
.setup-workspace-picker__select { flex: 1; }
.setup-header-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.setup-section { padding: 8px 0; }
.setup-section h3 { margin: 0 0 4px; font-size: 1rem; font-weight: 600; }
.setup-hint { font-size: 0.85rem; color: var(--p-text-muted-color, #64748b); margin: 0 0 16px; }
.field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.field label { font-size: 0.85rem; font-weight: 500; }
.field-hint { font-weight: 400; color: var(--p-text-muted-color, #94a3b8); }
.field-error { font-size: 0.8rem; color: var(--p-red-500, #ef4444); }
.setup-native-select {
  width: 100%; min-height: 2.5rem;
  border: 1px solid var(--p-content-border-color, #cbd5e1);
  border-radius: 6px; background: var(--p-content-background, #fff);
  color: var(--p-text-color, #1e293b); padding: 0.625rem 0.75rem; font: inherit;
}
.project-list { border: 1px solid var(--p-surface-200, #e2e8f0); border-radius: 8px; overflow: hidden; }
.project-item {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  border-bottom: 1px solid var(--p-surface-100, #f1f5f9); font-size: 0.88rem;
}
.project-item:last-child { border-bottom: none; }
.project-item__icon { color: var(--p-text-muted-color, #94a3b8); flex-shrink: 0; }
.project-item__info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.project-item__name { font-weight: 500; }
.project-item__path { font-size: 0.75rem; color: var(--p-text-muted-color, #94a3b8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-item__actions { display: flex; gap: 2px; flex-shrink: 0; }
.add-project-row { margin-top: 8px; }
.new-ws-key-preview { font-size: 0.85rem; color: var(--p-text-muted-color, #64748b); margin-bottom: 4px; }
.new-ws-key-preview code { font-size: 0.82rem; background: var(--p-surface-100, #f1f5f9); padding: 1px 5px; border-radius: 4px; }
.mb-2 { margin-bottom: 8px; } .mb-3 { margin-bottom: 12px; } .mb-4 { margin-bottom: 16px; }
.mt-2 { margin-top: 8px; } .mt-4 { margin-top: 16px; }
.w-full { width: 100%; }
.path-row { display: flex; gap: 8px; align-items: center; }
.path-row .p-inputtext { flex: 1; }
.model-select__option { display: flex; flex-direction: column; gap: 1px; }
.model-select__option-title { font-size: 0.85rem; font-weight: 500; }
.model-select__option-description { font-size: 0.7rem; color: var(--p-text-muted-color); }
.model-select__option-id { font-size: 0.68rem; color: var(--p-text-muted-color); font-family: monospace; }
</style>

<style>
html.dark-mode .setup-view { background: var(--p-surface-950); }
html.dark-mode .setup-card { background: var(--p-surface-900, #0f172a); border-color: var(--p-surface-700, #334155); }
html.dark-mode .project-list { border-color: var(--p-surface-700, #334155); }
html.dark-mode .project-item { border-bottom-color: var(--p-surface-700, #334155); }
html.dark-mode .new-ws-key-preview code { background: var(--p-surface-800, #1e293b); }
html.dark-mode .setup-native-select { background: var(--p-surface-900, #0f172a); border-color: var(--p-surface-700, #334155); color: var(--p-text-color, #e2e8f0); }
</style>
