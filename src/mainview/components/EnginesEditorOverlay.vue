<template>
  <Dialog
    :visible="visible"
    modal
    header="Engines"
    :style="{ width: '80vw', height: '80vh' }"
    :content-style="{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0 }"
    :closable="true"
    @update:visible="(v) => { if (!v) emit('close'); }"
  >
    <template #header>
      <div class="engines-modal__header">
        <i class="pi pi-server" />
        <span>Engines</span>
      </div>
    </template>

    <!-- Note -->
    <div class="engines-modal__note">
      <i class="pi pi-info-circle" />
      Editing <code>engines.yaml</code> — changes take effect after restarting Railyin.
    </div>

    <!-- Loading -->
    <div v-if="loading" class="engines-modal__loading">
      <i class="pi pi-spin pi-spinner" /> Loading engines.yaml…
    </div>

    <!-- Load error -->
    <div v-else-if="loadError" class="engines-modal__error">
      <i class="pi pi-exclamation-triangle" /> {{ loadError }}
    </div>

    <!-- Editor -->
    <div v-else ref="editorContainerEl" class="engines-modal__editor" />

    <template #footer>
      <div class="engines-modal__footer">
        <span v-if="validationError" class="engines-modal__validation-error">
          <i class="pi pi-times-circle" /> {{ validationError }}
        </span>
        <span v-else-if="!loading && !loadError" class="engines-modal__validation-valid">
          <i class="pi pi-check-circle" /> Valid YAML
        </span>
        <span v-else class="engines-modal__validation-placeholder" />
        <div class="engines-modal__actions">
          <Button label="Cancel" severity="secondary" text @click="emit('close')" :disabled="saving" />
          <Button
            label="Save"
            icon="pi pi-save"
            :loading="saving"
            :disabled="!!validationError || saving || loading || !!loadError"
            @click="onSave"
          />
        </div>
      </div>
      <div v-if="saveError" class="engines-modal__save-error">
        <i class="pi pi-exclamation-triangle" /> {{ saveError }}
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
loader.config({ monaco });
import * as jsYaml from "js-yaml";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { useDarkMode } from "../composables/useDarkMode";
import { api } from "../rpc";

const props = defineProps<{ visible: boolean }>();

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

const loading = ref(false);
const loadError = ref<string | null>(null);
const validationError = ref<string | null>(null);
const saveError = ref<string | null>(null);
const saving = ref(false);
const { isDark } = useDarkMode();

// ─── Monaco lifecycle ─────────────────────────────────────────────────────────

async function initEditor(content: string) {
  if (!editorContainerEl.value || editorDisposed) return;
  monacoInstance = await loader.init();
  if (editorDisposed || !editorContainerEl.value) return;

  editor = monacoInstance.editor.create(editorContainerEl.value, {
    value: content,
    language: "yaml",
    theme: isDark.value ? "vs-dark" : "vs",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 13,
    lineNumbers: "on",
    wordWrap: "on",
  });

  editor.onDidChangeModelContent(() => {
    validate(editor.getValue());
  });

  validate(content);
  nextTick(() => editor?.focus());
}

function disposeEditor() {
  editorDisposed = true;
  editor?.dispose();
  editor = null;
  monacoInstance = null;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(content: string) {
  try {
    jsYaml.load(content);
    validationError.value = null;
  } catch (err) {
    validationError.value = err instanceof Error ? err.message : String(err);
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function onSave() {
  if (validationError.value || saving.value) return;
  saveError.value = null;
  saving.value = true;
  try {
    const yaml = editor?.getValue() ?? "";
    await api("config.saveEnginesYaml", { yaml });
    emit("saved");
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
      loadError.value = null;
      validationError.value = null;
      loading.value = true;
      let content = "";
      try {
        const result = await api("config.getEnginesYaml", {});
        content = result.yaml;
      } catch (err) {
        loadError.value = err instanceof Error ? err.message : String(err);
        loading.value = false;
        return;
      }
      loading.value = false;
      await nextTick();
      await initEditor(content);
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
.engines-modal__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}

.engines-modal__note {
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

.engines-modal__loading,
.engines-modal__error {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--p-text-muted-color, #64748b);
  padding: 2rem;
}

.engines-modal__error {
  color: var(--p-red-500, #ef4444);
}

.engines-modal__editor {
  flex: 1;
  min-height: 0;
}

.engines-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 1rem;
}

.engines-modal__actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.engines-modal__validation-valid {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--p-green-600, #16a34a);
}

.engines-modal__validation-error {
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

.engines-modal__validation-placeholder {
  flex: 1;
}

.engines-modal__save-error {
  padding: 0.4rem 0;
  font-size: 0.8rem;
  color: var(--p-red-600, #dc2626);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}
</style>

<style>
html.dark-mode .engines-modal__note {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
</style>
