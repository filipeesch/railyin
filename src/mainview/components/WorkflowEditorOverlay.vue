<template>
  <Teleport to="body">
    <div v-if="visible" class="workflow-editor-overlay" @keydown.esc="onCancel">
      <!-- Header -->
      <div class="workflow-editor-overlay__header">
        <div class="workflow-editor-overlay__title">
          <i class="pi pi-file-edit" />
          <span>Edit Workflow: {{ templateName }}</span>
        </div>
        <Button icon="pi pi-times" severity="secondary" text rounded aria-label="Close" @click="onCancel" />
      </div>

      <!-- Note -->
      <div class="workflow-editor-overlay__note">
        <i class="pi pi-info-circle" />
        Changes apply to all boards using this template in the current workspace.
      </div>

      <!-- Editor -->
      <div ref="editorContainerEl" class="workflow-editor-overlay__editor" />

      <!-- Footer -->
      <div class="workflow-editor-overlay__footer">
        <span v-if="yamlError" class="workflow-editor-overlay__yaml-error">
          <i class="pi pi-times-circle" /> {{ yamlError }}
        </span>
        <span v-else class="workflow-editor-overlay__yaml-valid">
          <i class="pi pi-check-circle" /> Valid YAML
        </span>
        <div class="workflow-editor-overlay__actions">
          <Button label="Cancel" severity="secondary" text @click="onCancel" :disabled="saving" />
          <Button
            label="Save & Reload"
            icon="pi pi-save"
            :loading="saving"
            :disabled="!!yamlError || saving"
            @click="onSave"
          />
        </div>
      </div>

      <!-- Save error -->
      <div v-if="saveError" class="workflow-editor-overlay__save-error">
        <i class="pi pi-exclamation-triangle" /> {{ saveError }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import loader from "@monaco-editor/loader";
import * as jsYaml from "js-yaml";
import Button from "primevue/button";
import { electroview } from "../rpc";
import { useDarkMode } from "../composables/useDarkMode";

const props = defineProps<{
  visible: boolean;
  workspaceId?: number;
  templateId: string;
  templateName: string;
  initialYaml: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const editorContainerEl = ref<HTMLElement | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let monacoInstance: typeof import("monaco-editor") | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any = null;
let editorDisposed = false;

const yamlError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);
const { isDark } = useDarkMode();

// ─── Monaco lifecycle ─────────────────────────────────────────────────────────

async function initEditor() {
  if (!editorContainerEl.value || editorDisposed) return;
  monacoInstance = await loader.init();
  if (editorDisposed || !editorContainerEl.value) return;

  editor = monacoInstance.editor.create(editorContainerEl.value, {
    value: props.initialYaml,
    language: "yaml",
    theme: isDark.value ? "vs-dark" : "vs",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 13,
    lineNumbers: "on",
    wordWrap: "on",
  });

  // Validate on every change
  editor.onDidChangeModelContent(() => {
    validateYaml(editor.getValue());
  });

  // Initial validation
  validateYaml(props.initialYaml);

  // Focus the editor
  nextTick(() => editor?.focus());
}

function disposeEditor() {
  editorDisposed = true;
  editor?.dispose();
  editor = null;
  monacoInstance = null;
}

// ─── YAML validation ──────────────────────────────────────────────────────────

function validateYaml(content: string) {
  try {
    jsYaml.load(content);
    yamlError.value = null;
  } catch (err) {
    yamlError.value = err instanceof Error ? err.message : String(err);
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function onCancel() {
  emit("close");
}

async function onSave() {
  if (yamlError.value || saving.value) return;
  saveError.value = null;
  saving.value = true;

  try {
    const content = editor?.getValue() ?? props.initialYaml;
    await electroview.rpc.request["workflow.saveYaml"]({
      workspaceId: props.workspaceId,
      templateId: props.templateId,
      yaml: content,
    });
    emit("saved");
    emit("close");
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

// ─── Watch visibility ─────────────────────────────────────────────────────────

watch(
  () => props.visible,
  async (val) => {
    if (val) {
      editorDisposed = false;
      saveError.value = null;
      yamlError.value = null;
      await nextTick();
      await initEditor();
    } else {
      disposeEditor();
    }
  },
  { immediate: true },
);

watch(isDark, (dark) => {
  if (monacoInstance) monacoInstance.editor.setTheme(dark ? "vs-dark" : "vs");
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

onBeforeUnmount(() => {
  disposeEditor();
});
</script>

<style scoped>
.workflow-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--p-surface-0, #fff);
  display: flex;
  flex-direction: column;
}

.workflow-editor-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.workflow-editor-overlay__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.workflow-editor-overlay__note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 1rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.workflow-editor-overlay__editor {
  flex: 1;
  min-height: 0;
}

.workflow-editor-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
  gap: 1rem;
}

.workflow-editor-overlay__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.workflow-editor-overlay__yaml-valid {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-green-600, #16a34a);
}

.workflow-editor-overlay__yaml-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-red-500, #ef4444);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-editor-overlay__save-error {
  padding: 0.4rem 1rem;
  font-size: 0.8rem;
  color: var(--p-red-600, #dc2626);
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  background: var(--p-red-50, #fef2f2);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
</style>

<style>
html.dark-mode .workflow-editor-overlay {
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .workflow-editor-overlay__header {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .workflow-editor-overlay__note {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .workflow-editor-overlay__footer {
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .workflow-editor-overlay__save-error {
  border-top-color: var(--p-surface-700, #334155);
  background: color-mix(in srgb, var(--p-red-500) 15%, transparent);
}
</style>
