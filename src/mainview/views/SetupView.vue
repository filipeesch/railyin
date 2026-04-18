<template>
  <div class="setup-view">
    <div class="setup-card">
      <div class="setup-card__logo">
        <span class="logo-mark">R</span>
        <span class="logo-text">Railyn</span>
      </div>

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

      <div class="setup-section setup-section--compact">
        <h3>Workspace Config</h3>
        <p class="setup-hint">
          Edit <code>~/.railyn/workspaces/&lt;workspace&gt;/workspace.yaml</code> to configure the active workspace.
        </p>

        <Message v-if="workspaceStore.error" severity="error" :closable="false">
          {{ workspaceStore.error }}
        </Message>

        <div class="setup-header-actions">
          <Button
            label="Reload config"
            icon="pi pi-refresh"
            severity="secondary"
            :loading="workspaceStore.loading"
            @click="reloadWorkspaceConfig"
          />
          <Button
            v-if="hasAnyBoards"
            label="Go to board"
            icon="pi pi-arrow-right"
            icon-pos="right"
            @click="goToBoard"
          />
        </div>
      </div>

      <!-- Tab navigation -->
      <TabView v-model:activeIndex="activeTab">

        <!-- Register a project -->
        <TabPanel header="Projects">
          <div class="setup-section">
            <h3>Register a Project</h3>
            <p class="setup-hint">
              A project is a Git repository (or sub-folder within a monorepo)
              that tasks will be scoped to.
            </p>

            <div class="field">
              <label>Name</label>
              <InputText v-model="proj.name" placeholder="my-service" class="w-full" />
            </div>
            <div class="field">
              <label>Project path <span class="field-hint">(absolute)</span></label>
              <InputText
                v-model="proj.projectPath"
                placeholder="/home/user/projects/my-service"
                class="w-full"
              />
            </div>
            <div class="field">
              <label>Git root <span class="field-hint">(may differ in monorepos)</span></label>
              <InputText
                v-model="proj.gitRootPath"
                placeholder="/home/user/projects"
                class="w-full"
              />
            </div>
            <div class="field">
              <label>Default branch</label>
              <InputText v-model="proj.defaultBranch" placeholder="main" class="w-full" />
            </div>

            <Message v-if="projError" severity="error" :closable="false">{{ projError }}</Message>

            <Button
              v-if="!showLspPrompt"
              label="Register project"
              icon="pi pi-plus"
              :loading="projSaving"
              :disabled="!proj.name || !proj.projectPath || !proj.gitRootPath"
              @click="registerProject"
            />

            <!-- LSP Setup Prompt (shown after a project is registered) -->
            <LspSetupPrompt
              v-if="showLspPrompt"
              :detected-languages="lspLanguages"
              :project-path="lastRegisteredPath"
              @done="showLspPrompt = false; if (!visibleBoards.length) activeTab = 1;"
            />

            <!-- Project list -->
            <div v-if="visibleProjects.length" class="project-list">
              <h4>Registered projects</h4>
              <div
                v-for="p in visibleProjects"
                :key="p.id"
                class="project-item"
              >
                <i class="pi pi-folder" />
                <span>{{ p.name }}</span>
                <code class="project-path">{{ p.projectPath }}</code>
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- Create / manage boards -->
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
                <option v-for="workflow in workflowOptions" :key="workflow.value" :value="workflow.value">
                  {{ workflow.label }}
                </option>
              </select>
            </div>

            <Message v-if="boardError" severity="error" :closable="false">{{ boardError }}</Message>

            <Button
              label="Create board"
              icon="pi pi-plus"
              :disabled="!boardName.trim() || !boardWorkflowTemplateId"
              :loading="boardSaving"
              @click="createBoard"
            />

            <div v-if="visibleBoards.length" class="project-list">
              <h4>Boards</h4>
              <div
                v-for="b in visibleBoards"
                :key="b.id"
                class="project-item"
              >
                <i class="pi pi-table" />
                <span>{{ b.name }}</span>
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- Models allowlist -->
        <TabPanel header="Models">
          <div class="setup-section">
            <h3>Enabled Models</h3>
            <p class="setup-hint">
              Choose which models appear in the chat dropdown. Only checked models will be available for task execution.
            </p>
            <ModelTreeView />
          </div>
        </TabPanel>

      </TabView>

    </div>
  </div>
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
import { api } from "../rpc";
import { useWorkspaceStore } from "../stores/workspace";
import { useBoardStore } from "../stores/board";
import { useProjectStore } from "../stores/project";
import ModelTreeView from "../components/ModelTreeView.vue";
import LspSetupPrompt from "../components/LspSetupPrompt.vue";
import type { LspDetectedLanguage, WorkflowTemplate } from "../../shared/rpc-types";

const router = useRouter();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const projectStore = useProjectStore();

const activeTab = ref(0);

// Project form
const proj = reactive({
  name: "",
  projectPath: "",
  gitRootPath: "",
  defaultBranch: "main",
});
const projSaving = ref(false);
const projError = ref<string | null>(null);
const lspLanguages = ref<LspDetectedLanguage[]>([]);
const lastRegisteredPath = ref("");
const showLspPrompt = ref(false);

// Board form
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

  // Navigate to the tab most relevant for first-run
  if (!visibleProjects.value.length) activeTab.value = 0;
  else if (!visibleBoards.value.length) activeTab.value = 1;
});

function setWorkflowOptions(workflows: WorkflowTemplate[]) {
  workflowOptions.value = workflows.map((workflow) => ({
    label: workflow.name,
    value: workflow.id,
  }));
  if (!workflowOptions.value.length) {
    boardWorkflowTemplateId.value = "";
    return;
  }
  if (!workflowOptions.value.some((workflow) => workflow.value === boardWorkflowTemplateId.value)) {
    boardWorkflowTemplateId.value = workflowOptions.value[0]!.value;
  }
}

async function loadWorkflowOptions(workspaceKey: string | null) {
  boardWorkflowTemplateId.value = "";
  if (workspaceKey == null) {
    workflowOptions.value = [];
    return;
  }
  const config = await api("workspace.getConfig", { workspaceKey });
  setWorkflowOptions(config.workflows);
}

watch(
  () => workspaceStore.activeWorkspaceKey,
  async (workspaceKey) => {
    await loadWorkflowOptions(workspaceKey);
  },
  { immediate: true },
);

async function registerProject() {
  projError.value = null;
  projSaving.value = true;
  try {
    const registeredPath = proj.projectPath.trim();
    await projectStore.registerProject({
      workspaceKey: workspaceStore.activeWorkspaceKey ?? "default",
      name: proj.name.trim(),
      projectPath: registeredPath,
      gitRootPath: proj.gitRootPath.trim() || registeredPath,
      defaultBranch: proj.defaultBranch.trim() || "main",
    });
    proj.name = "";
    proj.projectPath = "";
    proj.gitRootPath = "";
    proj.defaultBranch = "main";

    // Detect languages and offer LSP setup if any were found
    try {
      const detected = await api("lsp.detectLanguages", { projectPath: registeredPath });
      if (detected.length > 0) {
        lastRegisteredPath.value = registeredPath;
        lspLanguages.value = detected;
        showLspPrompt.value = true;
        return; // LSP prompt takes over — skip nudging to boards tab
      }
    } catch {
      // LSP detection failure is non-fatal; proceed normally
    }

    // If we have projects now, nudge to boards tab
    if (!visibleBoards.value.length) activeTab.value = 1;
  } catch (e) {
    projError.value = e instanceof Error ? e.message : String(e);
  } finally {
    projSaving.value = false;
  }
}

async function createBoard() {
  boardError.value = null;
  boardSaving.value = true;
  try {
    if (!boardWorkflowTemplateId.value) {
      throw new Error("Select a workflow template");
    }
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

async function reloadWorkspaceConfig() {
  await workspaceStore.load();
  await loadWorkflowOptions(workspaceStore.activeWorkspaceKey);
}

async function goToBoard() {
  if (!boardStore.activeBoardId) {
    const currentWorkspaceBoard = boardStore.boards.find(
      (board) => board.workspaceKey === workspaceStore.activeWorkspaceKey,
    );
    if (currentWorkspaceBoard) {
      boardStore.selectBoard(currentWorkspaceBoard.id);
    } else {
      const firstBoard = boardStore.boards[0];
      if (firstBoard) {
        await workspaceStore.selectWorkspace(firstBoard.workspaceKey);
        boardStore.selectBoard(firstBoard.id);
      }
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
}

.setup-card {
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 14px;
  padding: 32px;
  width: 100%;
  max-width: 580px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.07);
}

.setup-card__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 24px;
}

.logo-mark {
  width: 36px;
  height: 36px;
  background: var(--p-primary-color, #6366f1);
  color: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.1rem;
}

.logo-text {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--p-text-color, #1e293b);
}

.setup-section {
  padding: 8px 0;
}

.setup-section--compact {
  padding-top: 0;
}

.setup-section h3 {
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 600;
}

.setup-hint {
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  margin: 0 0 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}

.field label {
  font-size: 0.85rem;
  font-weight: 500;
}

.field-hint {
  font-weight: 400;
  color: var(--p-text-muted-color, #94a3b8);
}

.setup-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.setup-native-select {
  width: 100%;
  min-height: 2.5rem;
  border: 1px solid var(--p-content-border-color, #cbd5e1);
  border-radius: 6px;
  background: var(--p-content-background, #fff);
  color: var(--p-text-color, #1e293b);
  padding: 0.625rem 0.75rem;
  font: inherit;
}

.project-list {
  margin-top: 20px;
}

.project-list h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--p-surface-100, #f1f5f9);
  font-size: 0.88rem;
}

.project-path {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-left: auto;
}

.mt-3 {
  margin-top: 12px;
}
</style>

<style>
html.dark-mode .setup-view {
  background: var(--p-surface-950);
}
html.dark-mode .setup-card {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .project-item {
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .setup-native-select {
  background: var(--p-surface-900, #0f172a);
  border-color: var(--p-surface-700, #334155);
  color: var(--p-text-color, #e2e8f0);
}
</style>
