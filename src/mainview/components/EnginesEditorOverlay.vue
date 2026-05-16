<template>
  <Teleport to="body">
    <div v-if="visible" class="file-editor-overlay" @keydown.esc="onCancel">
      <!-- Header -->
      <div class="file-editor-overlay__header">
        <div class="file-editor-overlay__title">
          <i class="pi pi-server" />
          <span>Engines</span>
        </div>
        <Button icon="pi pi-times" severity="secondary" text rounded aria-label="Close" @click="onCancel" />
      </div>

      <!-- Note -->
      <div class="file-editor-overlay__note">
        <i class="pi pi-info-circle" />
        Editing <code>engines.yaml</code> — changes take effect after restarting Railyin.
      </div>

      <!-- Loading state -->
      <div v-if="loading" class="engines-editor-overlay__loading">
        <i class="pi pi-spin pi-spinner" /> Loading engines.yaml…
      </div>

      <!-- Load error -->
      <div v-else-if="loadError" class="file-editor-overlay__save-error">
        <i class="pi pi-exclamation-triangle" /> {{ loadError }}
      </div>

      <!-- Editor -->
      <div v-else ref="editorContainerEl" class="file-editor-overlay__editor" />

      <!-- Footer -->
      <div class="file-editor-overlay__footer">
        <span v-if="validationError" class="file-editor-overlay__validation-error">
          <i class="pi pi-times-circle" /> {{ validationError }}
        </span>
        <span v-else-if="!loading && !loadError" class="file-editor-overlay__validation-valid">
          <i class="pi pi-check-circle" /> Valid YAML
        </span>
        <span v-else class="file-editor-overlay__validation-placeholder" />
        <div class="file-editor-overlay__actions">
          <Button label="Cancel" severity="secondary" text @click="onCancel" :disabled="saving" />
          <Button
            label="Save"
            icon="pi pi-save"
            :loading="saving"
            :disabled="!!validationError || saving || loading || !!loadError"
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
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";
loader.config({ monaco });
import * as jsYaml from "js-yaml";
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

// ─── Actions ─────────────────────────────────────────────────────────────────

function onCancel() {
  emit("close");
}

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
.engines-editor-overlay__loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--p-text-muted-color, #64748b);
}
</style>
