<template>
  <div v-if="visible" class="workflow-editor-overlay" @keydown.esc="onCancel">
    <div class="workflow-editor-dialog" tabindex="-1" ref="dialogEl">
      <!-- Title bar -->
      <div class="workflow-editor-dialog__header">
        <div class="workflow-editor-dialog__title">
          <i class="pi pi-file-edit" />
          <span>Edit Workflow: {{ templateName }}</span>
        </div>
        <Button icon="pi pi-times" severity="secondary" text rounded aria-label="Close" @click="onCancel" />
      </div>

      <!-- Note -->
      <div class="workflow-editor-dialog__note">
        <i class="pi pi-info-circle" />
        Changes apply to all boards using this template.
      </div>

      <!-- Editor -->
      <div ref="editorContainerEl" class="workflow-editor-dialog__editor" />

      <!-- Footer -->
      <div class="workflow-editor-dialog__footer">
        <span v-if="yamlError" class="workflow-editor-dialog__yaml-error">
          <i class="pi pi-times-circle" /> {{ yamlError }}
        </span>
        <span v-else class="workflow-editor-dialog__yaml-valid">
          <i class="pi pi-check-circle" /> Valid YAML
        </span>
        <div class="workflow-editor-dialog__actions">
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
      <div v-if="saveError" class="workflow-editor-dialog__save-error">
        <i class="pi pi-exclamation-triangle" /> {{ saveError }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import loader from "@monaco-editor/loader";
import * as jsYaml from "js-yaml";
import Button from "primevue/button";
import { electroview } from "../rpc";

const props = defineProps<{
  visible: boolean;
  templateId: string;
  templateName: string;
  initialYaml: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const dialogEl = ref<HTMLElement | null>(null);
const editorContainerEl = ref<HTMLElement | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let monacoInstance: typeof import("monaco-editor") | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any = null;
let editorDisposed = false;

const yamlError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);

// ─── Monaco lifecycle ─────────────────────────────────────────────────────────

async function initEditor() {
  if (!editorContainerEl.value || editorDisposed) return;
  monacoInstance = await loader.init();
  if (editorDisposed || !editorContainerEl.value) return;

  editor = monacoInstance.editor.create(editorContainerEl.value, {
    value: props.initialYaml,
    language: "yaml",
    theme: "vs-dark",
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
      dialogEl.value?.focus();
    } else {
      disposeEditor();
    }
  },
  { immediate: true },
);

// ─── Cleanup ──────────────────────────────────────────────────────────────────

onBeforeUnmount(() => {
  disposeEditor();
});
</script>

<style scoped>
.workflow-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.workflow-editor-dialog {
  display: flex;
  flex-direction: column;
  width: min(900px, 95vw);
  height: min(700px, 90vh);
  background: var(--p-surface-900, #1e1e1e);
  border: 1px solid var(--p-surface-700, #333);
  border-radius: 8px;
  overflow: hidden;
  outline: none;
}

.workflow-editor-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-surface-700, #333);
  flex-shrink: 0;
}

.workflow-editor-dialog__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.95rem;
}

.workflow-editor-dialog__note {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 1rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #888);
  background: var(--p-surface-800, #252525);
  border-bottom: 1px solid var(--p-surface-700, #333);
  flex-shrink: 0;
}

.workflow-editor-dialog__editor {
  flex: 1;
  min-height: 0;
}

.workflow-editor-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--p-surface-700, #333);
  flex-shrink: 0;
  gap: 1rem;
}

.workflow-editor-dialog__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.workflow-editor-dialog__yaml-valid {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-green-400, #4ade80);
}

.workflow-editor-dialog__yaml-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-red-400, #f87171);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-editor-dialog__save-error {
  padding: 0.4rem 1rem;
  font-size: 0.8rem;
  color: var(--p-red-400, #f87171);
  border-top: 1px solid var(--p-surface-700, #333);
  background: rgba(220, 38, 38, 0.1);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
</style>
