<template>
  <div class="setup-view">
    <div class="setup-card">
      <div class="setup-card__logo">
        <span class="logo-mark">R</span>
        <span class="logo-text">Railyn</span>
      </div>

      <!-- Tab navigation -->
      <TabView v-model:activeIndex="activeTab">

        <!-- Workspace / AI settings -->
        <TabPanel header="Workspace">
          <div class="setup-section">
            <h3>AI Provider</h3>
            <p class="setup-hint">
              Railyn uses any OpenAI-compatible API. Edit
              <code>~/.railyn/config/workspace.yaml</code> (or
              <code>config/workspace.yaml</code> in the repo) to configure.
            </p>

            <div v-if="workspaceStore.config" class="config-summary">
              <div class="config-row">
                <span class="config-label">Base URL</span>
                <code>{{ workspaceStore.config.ai.baseUrl }}</code>
              </div>
              <div class="config-row">
                <span class="config-label">Model</span>
                <code>{{ workspaceStore.config.ai.model }}</code>
              </div>
              <div class="config-row">
                <span class="config-label">API Key</span>
                <code>{{ workspaceStore.config.ai.apiKey ? "••••••••" : "not set" }}</code>
              </div>
            </div>

            <Message v-if="workspaceStore.error" severity="error" :closable="false">
              {{ workspaceStore.error }}
            </Message>

            <Button
              label="Reload config"
              icon="pi pi-refresh"
              severity="secondary"
              :loading="workspaceStore.loading"
              class="mt-3"
              @click="workspaceStore.load()"
            />
          </div>
        </TabPanel>

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
              label="Register project"
              icon="pi pi-plus"
              :loading="projSaving"
              :disabled="!proj.name || !proj.projectPath || !proj.gitRootPath"
              @click="registerProject"
            />

            <!-- Project list -->
            <div v-if="projectStore.projects.length" class="project-list">
              <h4>Registered projects</h4>
              <div
                v-for="p in projectStore.projects"
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

            <Message v-if="boardError" severity="error" :closable="false">{{ boardError }}</Message>

            <Button
              label="Create board"
              icon="pi pi-plus"
              :disabled="!boardName.trim()"
              :loading="boardSaving"
              @click="createBoard"
            />

            <div v-if="boardStore.boards.length" class="project-list">
              <h4>Boards</h4>
              <div
                v-for="b in boardStore.boards"
                :key="b.id"
                class="project-item"
              >
                <i class="pi pi-table" />
                <span>{{ b.name }}</span>
              </div>
            </div>
          </div>
        </TabPanel>

      </TabView>

      <!-- Done button (only shown when at least one board exists) -->
      <div class="setup-footer" v-if="boardStore.boards.length">
        <Button label="Go to board →" icon="pi pi-arrow-right" icon-pos="right" @click="goToBoard" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import TabView from "primevue/tabview";
import TabPanel from "primevue/tabpanel";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import Message from "primevue/message";
import { useWorkspaceStore } from "../stores/workspace";
import { useBoardStore } from "../stores/board";
import { useProjectStore } from "../stores/project";

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

// Board form
const boardName = ref("");
const boardSaving = ref(false);
const boardError = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([projectStore.loadProjects(), boardStore.loadBoards()]);
  if (!workspaceStore.config) await workspaceStore.load();

  // Navigate to the tab most relevant for first-run
  if (!workspaceStore.config) activeTab.value = 0;
  else if (!projectStore.projects.length) activeTab.value = 1;
  else if (!boardStore.boards.length) activeTab.value = 2;
});

async function registerProject() {
  projError.value = null;
  projSaving.value = true;
  try {
    await projectStore.registerProject({
      name: proj.name.trim(),
      projectPath: proj.projectPath.trim(),
      gitRootPath: proj.gitRootPath.trim() || proj.projectPath.trim(),
      defaultBranch: proj.defaultBranch.trim() || "main",
    });
    proj.name = "";
    proj.projectPath = "";
    proj.gitRootPath = "";
    proj.defaultBranch = "main";
    // If we have projects now, nudge to boards tab
    if (!boardStore.boards.length) activeTab.value = 2;
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
    await boardStore.createBoard(boardName.value.trim(), "delivery");
    boardName.value = "";
  } catch (e) {
    boardError.value = e instanceof Error ? e.message : String(e);
  } finally {
    boardSaving.value = false;
  }
}

function goToBoard() {
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

.config-summary {
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #94a3b8);
  width: 80px;
  flex-shrink: 0;
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

.setup-footer {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.mt-3 {
  margin-top: 12px;
}
</style>
