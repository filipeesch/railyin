<template>
  <Teleport to="body">
    <div v-if="visible" class="engine-management-overlay" @keydown.esc="onClose">
      <!-- Left pane: sidebar + form area -->
      <div class="engine-left">
        <!-- Sidebar: engine list -->
        <div class="engine-sidebar">
          <div class="engine-sidebar__header">
            <div class="engine-sidebar__title-group">
              <span class="engine-sidebar__title">
                <i class="pi pi-server" />
                Engines
              </span>
              <button class="engine-sidebar__import-btn" title="Import" @click="showImportDialog = true">
                <i class="pi pi-upload" />
              </button>
            </div>
          </div>

          <!-- Loading -->
          <div v-if="engineStore.loading" class="engine-sidebar__loading">
            <i class="pi pi-spin pi-spinner" />
            Loading…
          </div>

          <!-- Error -->
          <div v-else-if="engineStore.error" class="engine-sidebar__error">
            <i class="pi pi-exclamation-triangle" />
            {{ engineStore.error }}
          </div>

          <!-- Engine list -->
          <div v-else class="engine-list">
            <div
              v-for="engine in engineStore.engines"
              :key="engine.id"
              class="engine-list-item"
              :class="{ 'engine-list-item--selected': engineStore.selectedId === engine.id }"
              @click="engineStore.selectEngine(engine.id)"
            >
              <div class="engine-list-item__primary">
                <span class="engine-list-item__id">{{ engine.id }}</span>
                <span class="engine-list-item__type">{{ engine.type }}</span>
              </div>
              <button
                class="engine-list-item__export-btn"
                title="Export"
                @click.stop="engineStore.exportEngine(engine)"
              >
                <i class="pi pi-download" />
              </button>
            </div>
            <div v-if="engineStore.engines.length === 0" class="engine-list__empty">
              No engines configured
            </div>
          </div>
        </div>

        <!-- Right pane: detail panel + Monaco preview -->
        <div class="engine-detail">
          <template v-if="engineStore.selectedEngine">
            <!-- Header -->
            <div class="engine-detail__header">
              <span class="engine-detail__title">
                <i class="pi pi-server" />
                {{ engineStore.selectedEngine.id }}
              </span>
              <span class="engine-detail__type">{{ engineStore.selectedEngine.type }}</span>
            </div>

            <!-- Type-specific form fields -->
            <EngineDetailPanel
              :engine-id="engineStore.selectedEngine.id"
              :engine-type="engineStore.selectedEngine.type"
              :raw-yaml="engineStore.yaml"
              @yaml-update="onYamlUpdate"
            />

            <!-- Model management (pi engine) -->
            <ModelManagementPanel
              v-if="engineStore.selectedEngine.type === 'pi'"
              :raw-yaml="engineStore.yaml"
              @model-update="onModelUpdate"
            />

            <!-- Monaco YAML preview -->
            <div ref="monacoContainer" class="engine-detail__monaco-container" />
          </template>

          <!-- No engine selected -->
          <div v-else class="engine-detail__empty">
            <i class="pi pi-server" />
            Select an engine from the list to view its configuration
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Import Dialog -->
  <Dialog
    v-model:visible="showImportDialog"
    modal
    header="Import Engines"
    :style="{ width: '500px' }"
    :closable="!importing"
  >
    <div class="import-dialog">
      <div class="import-dialog__note">
        <i class="pi pi-info-circle" />
        Select an engines.yaml file to import. Conflicts with existing engine IDs will be resolved by replacing them.
      </div>

      <label class="import-dialog__field">
        YAML File
        <input type="file" accept=".yaml,.yml" @change="onFileSelect" />
      </label>

      <label v-if="importContent" class="import-dialog__field">
        Content Preview
        <textarea
          v-model="importContent"
          class="import-dialog__textarea"
          rows="8"
          readonly
        />
      </label>

      <div v-if="importError" class="import-dialog__error">
        <i class="pi pi-exclamation-triangle" />
        {{ importError }}
      </div>
    </div>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        @click="showImportDialog = false"
        :disabled="importing"
      />
      <Button
        label="Import"
        :loading="importing"
        :disabled="!importContent.trim() || importing"
        @click="doImport"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
loader.config({ monaco });
import { useEngineStore } from "../stores/engine";
import { useDarkMode } from "../composables/useDarkMode";
import EngineDetailPanel from "./EngineDetailPanel.vue";
import ModelManagementPanel from "./ModelManagementPanel.vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { importEnginesYaml } from "../rpc";

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const props = defineProps<{ visible: boolean }>();
const engineStore = useEngineStore();
const monacoContainer = ref<HTMLElement | null>(null);
let monacoInstance: typeof import("monaco-editor") | null = null;
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
const { isDark } = useDarkMode();

// ─── Import state ────────────────────────────────────────────────────────────

const showImportDialog = ref(false);
const importContent = ref("");
const importError = ref("");
const importing = ref(false);

function onFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importContent.value = reader.result as string;
    importError.value = "";
  };
  reader.onerror = () => {
    importError.value = "Failed to read file";
  };
  reader.readAsText(file);
}

async function doImport() {
  if (!importContent.value.trim()) {
    importError.value = "No content";
    return;
  }
  importing.value = true;
  importError.value = "";
  try {
    await importEnginesYaml(importContent.value);
    await engineStore.loadEngines();
    showImportDialog.value = false;
    importContent.value = "";
  } catch (err) {
    importError.value = err instanceof Error ? err.message : "Import failed";
  } finally {
    importing.value = false;
  }
}

// Pending YAML update if form changes before Monaco initializes
let pendingYamlUpdate: string | null = null;

// ─── Prop watcher (Teleport pattern) ────────────────────────────────────────

const mounted = ref(false);
watch(
  () => props.visible,
  async (val) => {
    if (val) {
      mounted.value = true;
      await engineStore.loadEngines();
    } else {
      mounted.value = false;
      disposeEditor();
    }
  },
  { immediate: true },
);

// ─── Monaco lifecycle ────────────────────────────────────────────────────────

async function initOrSetEditor(content: string) {
  if (!monacoContainer.value) return;
  if (!monacoInstance) {
    monacoInstance = await loader.init();
  }
  if (!monacoContainer.value) return;
  if (!editor) {
    editor = monacoInstance.editor.create(monacoContainer.value, {
      value: content,
      language: "yaml",
      theme: isDark.value ? "vs-dark" : "vs",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "on",
      readOnly: true,
    });
  } else {
    editor.setValue(content);
  }
  // Flush any pending YAML updates that arrived before editor was ready
  if (pendingYamlUpdate) {
    editor.setValue(pendingYamlUpdate);
    pendingYamlUpdate = null;
  }
}

function disposeEditor() {
  editor?.dispose();
  editor = null;
  monacoInstance = null;
}

// ─── Watch selected engine YAML ──────────────────────────────────────────────

watch(
  () => engineStore.selectedId,
  async () => {
    if (engineStore.selectedEngine) {
      await nextTick();
      await initOrSetEditor(engineStore.selectedEngine.yaml ?? "");
    }
  },
);

// ─── Form → YAML sync ────────────────────────────────────────────────────────

function onYamlUpdate(yaml: string) {
  engineStore.setYaml(yaml);
  if (editor) {
    editor.setValue(yaml);
  } else {
    pendingYamlUpdate = yaml;
  }
}

// ─── Model → YAML sync ───────────────────────────────────────────────────────

function onModelUpdate(yaml: string) {
  engineStore.setYaml(yaml);
  if (editor) {
    editor.setValue(yaml);
  } else {
    pendingYamlUpdate = yaml;
  }
}

// ─── Dark mode ───────────────────────────────────────────────────────────────

watch(isDark, (dark) => {
  if (monacoInstance) monacoInstance.editor.setTheme(dark ? "vs-dark" : "vs");
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function onClose() {
  engineStore.selectEngine(null);
  emit("close");
}
</script>

<style scoped>
.engine-management-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.engine-left {
  display: flex;
  width: 80vw;
  height: 80vh;
  background: var(--p-content-background, #fff);
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

/* ── Sidebar ── */

.engine-sidebar {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--p-content-border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  background: var(--p-surface-50, #f8fafc);
}

.engine-sidebar__header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
}

.engine-sidebar__title {
  font-weight: 600;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.engine-sidebar__loading,
.engine-sidebar__error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
}

.engine-sidebar__error {
  color: var(--p-red-500, #ef4444);
}

.engine-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.25rem 0;
}

.engine-list-item {
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  transition: background 0.15s;
}

.engine-list-item:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.engine-list-item--selected {
  background: var(--p-blue-50, #eff6ff);
  border-left: 3px solid var(--p-blue-500, #3b82f6);
}

.engine-list-item__primary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.engine-list-item__id {
  font-weight: 500;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.engine-list-item__type {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #64748b);
  background: var(--p-surface-200, #e2e8f0);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  flex-shrink: 0;
}

.engine-list-item__export-btn {
  padding: 0.15rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.75rem;
  border-radius: 2px;
  flex-shrink: 0;
  transition: color 0.15s;
}

.engine-list-item__export-btn:hover {
  color: var(--p-blue-500, #3b82f6);
}

/* ── Import ── */

.engine-sidebar__title-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.engine-sidebar__import-btn {
  padding: 0.15rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.75rem;
  border-radius: 2px;
  transition: color 0.15s;
}

.engine-sidebar__import-btn:hover {
  color: var(--p-blue-500, #3b82f6);
}

.import-dialog__note {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.5rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
  background: var(--p-surface-50, #f8fafc);
  border-radius: 4px;
  margin-bottom: 0.75rem;
}

.import-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.import-dialog__textarea {
  font-family: monospace;
  font-size: 0.8rem;
  padding: 0.5rem;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 4px;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #1e293b);
  resize: vertical;
}

.import-dialog__error {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.5rem;
  font-size: 0.8rem;
  color: var(--p-red-500, #ef4444);
  background: var(--p-red-50, #fef2f2);
  border-radius: 4px;
  margin-top: 0.5rem;
}

.engine-list__empty {
  padding: 1rem;
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  text-align: center;
}

/* ── Detail pane ── */

.engine-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.engine-detail__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  background: var(--p-surface-50, #f8fafc);
  flex-shrink: 0;
}

.engine-detail__title {
  font-weight: 600;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.engine-detail__type {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #64748b);
  background: var(--p-surface-200, #e2e8f0);
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
}

.engine-detail__form {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  display: flex;
  gap: 0.75rem;
  flex-shrink: 0;
}

.engine-detail__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  max-width: 300px;
}

.engine-detail__input {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 4px;
  font-size: 0.85rem;
  background: var(--p-surface-0, #fff);
  color: var(--p-text-color, #1e293b);
  outline: none;
  transition: border-color 0.15s;
}

.engine-detail__input:focus {
  border-color: var(--p-blue-500, #3b82f6);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.engine-detail__monaco-container {
  flex: 1;
  min-height: 0;
}

.engine-detail__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.9rem;
}

.engine-detail__empty i {
  font-size: 2rem;
  opacity: 0.4;
}
</style>

<style>
html.dark-mode .engine-sidebar {
  background: var(--p-surface-900, #0f172a);
}

html.dark-mode .engine-list-item {
  border-bottom-color: var(--p-surface-700, #334155);
}

html.dark-mode .engine-list-item:hover {
  background: var(--p-surface-800, #1e293b);
}

html.dark-mode .engine-list-item--selected {
  background: var(--p-blue-900, #1e3a5f);
  border-left-color: var(--p-blue-400, #60a5fa);
}

html.dark-mode .engine-detail__header {
  background: var(--p-surface-900, #0f172a);
  border-bottom-color: var(--p-surface-700, #334155);
}

html.dark-mode .engine-detail__form {
  border-bottom-color: var(--p-surface-700, #334155);
}

html.dark-mode .engine-detail__input {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-600, #475569);
  color: var(--p-surface-0, #fff);
}

html.dark-mode .engine-sidebar__import-btn {
  color: var(--p-text-muted-color, #94a3b8);
}

html.dark-mode .engine-sidebar__import-btn:hover {
  color: var(--p-blue-400, #60a5fa);
}

html.dark-mode .import-dialog__note {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-700, #334155);
}

html.dark-mode .import-dialog__textarea {
  background: var(--p-surface-700, #334155);
  border-color: var(--p-surface-600, #475569);
  color: var(--p-surface-0, #fff);
}

html.dark-mode .import-dialog__error {
  background: var(--p-red-900, #450a0a);
}
</style>
