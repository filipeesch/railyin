<template>
  <Teleport to="body">
    <div v-if="visible" class="file-editor-overlay" @keydown.esc="onCancel">
      <!-- Header -->
      <div class="file-editor-overlay__header">
        <div class="file-editor-overlay__title">
          <i class="pi pi-file-edit" />
          <span>{{ title }}</span>
        </div>
        <Button icon="pi pi-times" severity="secondary" text rounded aria-label="Close" @click="onCancel" />
      </div>

      <!-- Note (optional) -->
      <div v-if="note" class="file-editor-overlay__note">
        <i class="pi pi-info-circle" />
        {{ note }}
      </div>

      <!-- Editor -->
      <div ref="editorContainerEl" class="file-editor-overlay__editor" />

      <!-- Footer -->
      <div class="file-editor-overlay__footer">
        <span v-if="validationError" class="file-editor-overlay__validation-error">
          <i class="pi pi-times-circle" /> {{ validationError }}
        </span>
        <span v-else-if="showValidation" class="file-editor-overlay__validation-valid">
          <i class="pi pi-check-circle" /> Valid {{ language.toUpperCase() }}
        </span>
        <span v-else class="file-editor-overlay__validation-placeholder" />
        <div class="file-editor-overlay__actions">
          <Button label="Cancel" severity="secondary" text @click="onCancel" :disabled="saving" />
          <Button
            :label="saveLabel"
            :icon="saveIcon"
            :loading="saving"
            :disabled="!!validationError || saving"
            @click="onSave"
          />
        </div>
      </div>

      <!-- Save error -->
      <div v-if="saveError" class="file-editor-overlay__save-error">
        <i class="pi pi-exclamation-triangle" /> {{ saveError }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, computed } from "vue";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
loader.config({ monaco });
import * as jsYaml from "js-yaml";
import Button from "primevue/button";
import { useDarkMode } from "../composables/useDarkMode";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    content: string;
    language?: string;
    note?: string;
    saveLabel?: string;
    saveIcon?: string;
  }>(),
  {
    language: "json",
    saveLabel: "Save",
    saveIcon: "pi pi-save",
  },
);

const emit = defineEmits<{
  close: [];
  save: [content: string];
}>();

const editorContainerEl = ref<HTMLElement | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let monacoInstance: typeof import("monaco-editor") | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any = null;
let editorDisposed = false;

const validationError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);
const { isDark } = useDarkMode();

const showValidation = computed(() => props.language === "json" || props.language === "yaml");

// ─── Monaco lifecycle ─────────────────────────────────────────────────────────

async function initEditor() {
  if (!editorContainerEl.value || editorDisposed) return;
  monacoInstance = await loader.init();
  if (editorDisposed || !editorContainerEl.value) return;

  editor = monacoInstance.editor.create(editorContainerEl.value, {
    value: props.content,
    language: props.language,
    theme: isDark.value ? "vs-dark" : "vs",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 13,
    lineNumbers: "on",
    wordWrap: "on",
  });

  // Expose editor instance for E2E tests (used by waitForMonaco / getValue / setValue)
  (window as any).__mcpJsonEditor = editor;

  editor.onDidChangeModelContent(() => {
    validate(editor.getValue());
  });

  validate(props.content);
  nextTick(() => editor?.focus());
}

function disposeEditor() {
  editorDisposed = true;
  editor?.dispose();
  editor = null;
  monacoInstance = null;
  delete (window as any).__mcpJsonEditor;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(content: string) {
  if (props.language === "json") {
    try {
      JSON.parse(content);
      validationError.value = null;
    } catch (err) {
      validationError.value = err instanceof Error ? err.message : String(err);
    }
  } else if (props.language === "yaml") {
    try {
      jsYaml.load(content);
      validationError.value = null;
    } catch (err) {
      validationError.value = err instanceof Error ? err.message : String(err);
    }
  } else {
    validationError.value = null;
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function onCancel() {
  emit("close");
}

async function onSave() {
  if (validationError.value || saving.value) return;
  saveError.value = null;
  saving.value = true;
  try {
    const value = editor?.getValue() ?? props.content;
    emit("save", value);
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
      validationError.value = null;
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
.file-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--p-surface-0, #fff);
  display: flex;
  flex-direction: column;
}

.file-editor-overlay__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.file-editor-overlay__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
}

.file-editor-overlay__note {
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

.file-editor-overlay__editor {
  flex: 1;
  min-height: 0;
}

.file-editor-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
  gap: 1rem;
}

.file-editor-overlay__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.file-editor-overlay__validation-valid {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-green-600, #16a34a);
}

.file-editor-overlay__validation-error {
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

.file-editor-overlay__validation-placeholder {
  flex: 1;
}

.file-editor-overlay__save-error {
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
html.dark-mode .file-editor-overlay {
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .file-editor-overlay__header {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .file-editor-overlay__note {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .file-editor-overlay__footer {
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .file-editor-overlay__save-error {
  border-top-color: var(--p-surface-700, #334155);
  background: color-mix(in srgb, var(--p-red-500) 15%, transparent);
}
</style>
