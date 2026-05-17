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

      <TabView v-model:activeIndex="activeTab" :scrollable="true" @tab-change="onTabChange">

        <TabPanel header="Workspace">
          <div class="setup-section">
            <div class="field">
              <label>Workspace name</label>
              <InputText v-model="wsForm.name" placeholder="My Workspace" class="w-full" />
            </div>
            <div class="field">
              <label>Engines</label>
              <div class="engine-checkbox-list">
                <div v-for="engine in availableEngines" :key="engine.id" class="engine-checkbox-item">
                  <Checkbox
                    v-model="wsForm.allowedEngines"
                    :value="engine.id"
                    :inputId="`engine-${engine.id}`"
                    @change="onAllowedEnginesChange"
                  />
                  <label :for="`engine-${engine.id}`">{{ engineLabel(engine) }}</label>
                </div>
                <small v-if="availableEngines.length === 0" class="field-hint">No engines configured in engines.yaml</small>
              </div>
            </div>
            <div class="field">
              <label>Default model <span class="field-hint">(optional)</span></label>
              <Select
                v-model="wsForm.defaultModel"
                :options="groupedModels"
                optionGroupLabel="label"
                optionGroupChildren="items"
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
                <!-- Per-language badges -->
                <div class="project-item__badges">
                  <template v-if="projectLanguages.get(p.key)?.scanned">
                    <template v-for="lang in projectLanguages.get(p.key)!.languages" :key="lang.entry.serverName">
                      <!-- Green: installed and in config -->
                      <Tag
                        v-if="lang.alreadyInstalled && lang.inConfig"
                        :value="lang.entry.name"
                        severity="success"
                        class="project-item__lang-badge"
                      />
                      <!-- Orange: detected but not fully set up — explicit install button -->
                      <Button
                        v-else
                        :label="`Install ${lang.entry.name} LSP`"
                        icon="pi pi-download"
                        severity="warn"
                        size="small"
                        outlined
                        class="project-item__lang-install-btn"
                        @click="openInstallModal(lang, p.key, p.projectPath.absolute)"
                      />
                    </template>
                    <!-- No languages detected -->
                    <span v-if="!projectLanguages.get(p.key)!.languages.length" class="project-item__no-lang">—</span>
                  </template>
                  <i v-else class="pi pi-spin pi-spinner project-item__scan-spinner" />
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
          </div>
        </TabPanel>

        <TabPanel header="Language Servers">
          <div class="setup-section">
            <h3>Language Servers</h3>
            <p class="setup-hint">Detect and configure workspace-wide language servers for code navigation and completions.</p>

            <!-- Existing configured servers -->
            <div v-if="lspServerCount > 0" class="ls-configured-list">
              <p class="ls-configured-label">Configured servers ({{ lspServerCount }})</p>
              <div
                v-for="server in workspaceStore.config?.lsp?.servers"
                :key="server.name"
                class="ls-configured-item"
              >
                <i class="pi pi-check-circle ls-configured-item__icon" />
                <span class="ls-configured-item__name">{{ server.name }}</span>
                <code class="ls-configured-item__cmd">{{ server.command }}</code>
              </div>
            </div>

            <Button
              label="Scan for languages"
              icon="pi pi-search"
              severity="secondary"
              outlined
              :loading="lsScanning"
              class="mb-4"
              @click="scanLanguages"
            />
            <div v-if="lsNoLanguages" class="ls-empty-msg">
              <template v-if="!visibleProjects.length">
                <i class="pi pi-info-circle" /> Add projects first so Railyn knows where to scan.
              </template>
              <template v-else>
                <i class="pi pi-info-circle" /> No supported languages detected in your projects.
              </template>
            </div>
            <LspSetupPrompt
              v-if="lsLanguages.length > 0"
              :detected-languages="lsLanguages"
              :project-path="wsForm.workspacePath || lastKnownProjectPath"
              :workspace-key="workspaceStore.activeWorkspaceKey ?? 'default'"
              @done="lsLanguages = []"
            />
          </div>
        </TabPanel>

        <TabPanel header="Workflows">
          <WorkflowSetupTab />
        </TabPanel>

        <TabPanel header="Boards">
          <BoardSetupTab />
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

  <LspInstallModal
    v-if="installModalLang"
    :lang="installModalLang"
    :project-key="installModalProjectKey"
    :project-path="installModalProjectPath"
    :workspace-key="workspaceStore.activeWorkspaceKey ?? 'default'"
    @done="onInstallDone(installModalProjectKey, installModalProjectPath)"
    @cancel="closeInstallModal"
  />

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
import Checkbox from "primevue/checkbox";
import Button from "primevue/button";
import Message from "primevue/message";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import { api } from "../rpc";
import { useWorkspaceStore } from "../stores/workspace";
import { useBoardStore } from "../stores/board";
import { useWorkflowStore } from "../stores/workflow";
import { useProjectStore } from "../stores/project";
import { useTaskStore } from "../stores/task";
import ModelTreeView from "../components/ModelTreeView.vue";
import LspSetupPrompt from "../components/LspSetupPrompt.vue";
import LspInstallModal from "../components/LspInstallModal.vue";
import ProjectDetailDialog from "../components/ProjectDetailDialog.vue";
import BoardSetupTab from "../components/BoardSetupTab.vue";
import WorkflowSetupTab from "../components/WorkflowSetupTab.vue";
import type { LspDetectedLanguage, ModelInfo, Project } from "../../shared/rpc-types";

const router = useRouter();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const workflowStore = useWorkflowStore();
const projectStore = useProjectStore();
const taskStore = useTaskStore();

const activeTab = ref(0);

// Tab indices: 0=Workspace, 1=Projects, 2=Language Servers, 3=Workflows, 4=Boards, 5=Models
const LS_TAB_INDEX = 2;
const PROJECTS_TAB_INDEX = 1;
const WORKFLOWS_TAB_INDEX = 3;
const BOARDS_TAB_INDEX = 4;
function onTabChange(event: { index: number }) {
  if (event.index === BOARDS_TAB_INDEX) {
    boardStore.loadBoards();
  }
  if (event.index === WORKFLOWS_TAB_INDEX) {
    workflowStore.loadWorkflows(workspaceStore.activeWorkspaceKey ?? undefined);
  }
  if (event.index === PROJECTS_TAB_INDEX) {
    scanProjectLanguages();
  }
}

// ── Workspace settings form ──────────────────────────────────────────────────
const wsForm = reactive({
  name: "",
  allowedEngines: [] as string[],
  defaultModel: null as string | null,
  worktreeBasePath: "",
  workspacePath: "",
});
const wsSaving = ref(false);
const wsSaveError = ref<string | null>(null);
const wsSaveSuccess = ref(false);

const availableEngines = computed(() => workspaceStore.config?.availableEngines ?? []);

const ENGINE_LABELS: Record<string, string> = {
  copilot: "GitHub Copilot",
  claude: "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
};
function engineLabel(engine: { id: string; type: string }): string {
  return ENGINE_LABELS[engine.type] ?? engine.id;
}

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
    const found = group.items.find((item) => item.id === wsForm.defaultModel);
    if (found) return found;
  }
  return null;
});

const browsingWorktreePath = ref(false);
const browsingWorkspacePath = ref(false);

async function loadModelsForEngines(engineIds?: string[]) {
  modelsLoading.value = true;
  modelsError.value = null;
  try {
    const workspaceKey = workspaceStore.activeWorkspaceKey ?? undefined;
    let providerLists;
    if (engineIds !== undefined) {
      if (engineIds.length === 0) {
        allModelsFlat.value = [];
        return;
      }
      const results = await Promise.all(
        engineIds.map((id) => api("models.list", { workspaceKey, engineType: id })),
      );
      providerLists = results.flat();
    } else {
      providerLists = await api("models.list", { workspaceKey });
    }
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
  wsForm.allowedEngines = cfg.allowedEngines ?? [];
  wsForm.defaultModel = cfg.defaultModel ?? null;
  wsForm.worktreeBasePath = cfg.worktreeBasePath ?? "";
  wsForm.workspacePath = cfg.workspacePath ?? "";
}

async function onAllowedEnginesChange() {
  wsForm.defaultModel = null;
  await loadModelsForEngines(wsForm.allowedEngines);
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
      allowedEngines: wsForm.allowedEngines,
      defaultModel: wsForm.defaultModel ?? undefined,
      worktreeBasePath: wsForm.worktreeBasePath || undefined,
      workspacePath: wsForm.workspacePath || undefined,
    });
    await loadModelsForEngines();
    await Promise.all([
      workspaceStore.loadEnabledModels(),
      workspaceStore.loadAllModels(),
    ]);
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

// Tracks the last known project path for the Language Servers tab scan fallback
const lastKnownProjectPath = ref("");

// ── Language Servers tab ─────────────────────────────────────────────────────

/** Per-project language scan cache. Key = project.key */
interface ProjectScanEntry { scanned: boolean; languages: LspDetectedLanguage[] }
const projectLanguages = ref(new Map<string, ProjectScanEntry>());

const lsLanguages = ref<LspDetectedLanguage[]>([]);
const lsScanning = ref(false);
const lsNoLanguages = ref(false);

const lspServerCount = computed(() =>
  workspaceStore.config?.lsp?.servers?.length ?? 0,
);

/** Modal state for per-project install */
const installModalLang = ref<LspDetectedLanguage | null>(null);
const installModalProjectKey = ref("");
const installModalProjectPath = ref("");

function openInstallModal(lang: LspDetectedLanguage, projectKey: string, projectPath: string) {
  installModalLang.value = lang;
  installModalProjectKey.value = projectKey;
  installModalProjectPath.value = projectPath;
}

function closeInstallModal() {
  installModalLang.value = null;
}

async function onInstallDone(projectKey: string, projectPath: string) {
  installModalLang.value = null;
  // Re-scan the project to refresh its badges
  const entry: ProjectScanEntry = { scanned: false, languages: [] };
  projectLanguages.value.set(projectKey, entry);
  try {
    const detected = await api("lsp.detectLanguages", {
      projectPath,
      workspaceKey: workspaceStore.activeWorkspaceKey ?? "default",
    });
    projectLanguages.value.set(projectKey, { scanned: true, languages: detected });
  } catch {
    projectLanguages.value.set(projectKey, { scanned: true, languages: [] });
  }
  // Force reactivity
  projectLanguages.value = new Map(projectLanguages.value);
  // Reload workspace config to update the LS tab configured list
  await workspaceStore.load();
}

function goToLsTab() {
  activeTab.value = LS_TAB_INDEX;
}

/** Scan languages for projects that haven't been scanned yet. */
async function scanProjectLanguages() {
  const wsKey = workspaceStore.activeWorkspaceKey ?? "default";
  const projects = visibleProjects.value;
  if (!projects.length) return;

  const pending = projects.filter((p) => !projectLanguages.value.get(p.key)?.scanned);
  if (!pending.length) return;

  await Promise.all(
    pending.map(async (p) => {
      try {
        const detected = await api("lsp.detectLanguages", {
          projectPath: p.projectPath.absolute,
          workspaceKey: wsKey,
        });
        projectLanguages.value.set(p.key, { scanned: true, languages: detected });
      } catch {
        projectLanguages.value.set(p.key, { scanned: true, languages: [] });
      }
    }),
  );
  // Force reactivity
  projectLanguages.value = new Map(projectLanguages.value);
}

/** Full re-scan for the Language Servers tab. */
async function scanLanguages() {
  lsScanning.value = true;
  lsNoLanguages.value = false;
  lsLanguages.value = [];
  const projects = visibleProjects.value;
  if (!projects.length) {
    lsNoLanguages.value = true;
    lsScanning.value = false;
    return;
  }
  const wsKey = workspaceStore.activeWorkspaceKey ?? "default";
  try {
    const results = await Promise.all(
      projects.map((p) =>
        api("lsp.detectLanguages", {
          projectPath: p.projectPath.absolute,
          workspaceKey: wsKey,
        }),
      ),
    );
    // Merge by serverName, prefer already-installed entries
    const merged = new Map<string, LspDetectedLanguage>();
    for (const langs of results) {
      for (const lang of langs) {
        const existing = merged.get(lang.entry.serverName);
        if (!existing || lang.alreadyInstalled) {
          merged.set(lang.entry.serverName, lang);
        }
      }
    }
    const deduped = [...merged.values()];
    if (deduped.length > 0) {
      lsLanguages.value = deduped;
    } else {
      lsNoLanguages.value = true;
    }
  } catch {
    lsNoLanguages.value = true;
  }
  lsScanning.value = false;
}

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
      lastKnownProjectPath.value = registeredProject.projectPath.absolute;
      projectDialogVisible.value = false;
      if (!visibleBoards.value.length) activeTab.value = BOARDS_TAB_INDEX;
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
  await loadModelsForEngines();
  syncWsForm();
  if (!visibleProjects.value.length) activeTab.value = 1;
  else if (!visibleBoards.value.length) activeTab.value = BOARDS_TAB_INDEX;
  // Trigger background scan for projects tab (default view when projects exist)
  if (visibleProjects.value.length) {
    scanProjectLanguages();
  }
});

watch(() => workspaceStore.config, () => { syncWsForm(); });

watch(
  () => workspaceStore.activeWorkspaceKey,
  async () => {
    await loadModelsForEngines();
    syncWsForm();
    // Clear per-project language scan cache when workspace changes
    projectLanguages.value = new Map();
    // Re-scan immediately if the Projects tab is already open
    if (activeTab.value === PROJECTS_TAB_INDEX) {
      await scanProjectLanguages();
    }
  },
  { immediate: true },
);

async function onWorkspaceSelected(workspaceKey: string) {
  await workspaceStore.selectWorkspace(workspaceKey);
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
  max-width: 900px;
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
.engine-checkbox-list { display: flex; flex-direction: column; gap: 8px; }
.engine-checkbox-item { display: flex; align-items: center; gap: 8px; }
.engine-checkbox-item label { font-size: 0.9rem; font-weight: 400; cursor: pointer; }
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
.project-item__lsp-badge { font-size: 0.72rem; flex-shrink: 0; }

.project-item__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
  align-items: center;
  min-width: 60px;
}

.project-item__lang-badge { font-size: 0.7rem; }

.project-item__lang-install-btn {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  height: auto;
  line-height: 1.4;
}

.project-item__no-lang {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
}

.project-item__scan-spinner {
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
}
.ls-empty-msg { font-size: 0.85rem; color: var(--p-text-muted-color, #94a3b8); display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
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

.ls-configured-list {
  margin-bottom: 16px;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}
.ls-configured-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 12px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  margin: 0;
}
.ls-configured-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-surface-100, #f1f5f9);
}
.ls-configured-item:last-child { border-bottom: none; }
.ls-configured-item__icon { color: var(--p-green-500, #22c55e); font-size: 0.85rem; }
.ls-configured-item__name { font-size: 0.85rem; font-weight: 500; flex: 1; }
.ls-configured-item__cmd { font-size: 0.75rem; color: var(--p-text-muted-color, #64748b); }
</style>

<style>
html.dark-mode .setup-view { background: var(--p-surface-950); }
html.dark-mode .setup-card { background: var(--p-surface-900, #0f172a); border-color: var(--p-surface-700, #334155); }
html.dark-mode .project-list { border-color: var(--p-surface-700, #334155); }
html.dark-mode .project-item { border-bottom-color: var(--p-surface-700, #334155); }
html.dark-mode .new-ws-key-preview code { background: var(--p-surface-800, #1e293b); }
html.dark-mode .setup-native-select { background: var(--p-surface-900, #0f172a); border-color: var(--p-surface-700, #334155); color: var(--p-text-color, #e2e8f0); }
html.dark-mode .ls-configured-list { border-color: var(--p-surface-700, #334155); }
html.dark-mode .ls-configured-label { background: var(--p-surface-800, #1e293b); border-bottom-color: var(--p-surface-700, #334155); }
html.dark-mode .ls-configured-item { border-bottom-color: var(--p-surface-700, #334155); }
</style>
