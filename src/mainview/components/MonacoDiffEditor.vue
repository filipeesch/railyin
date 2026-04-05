<template>
  <div ref="containerEl" class="monaco-diff-editor" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import type { App } from "vue";
import loader from "@monaco-editor/loader";

export interface ILineChange {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

const props = withDefaults(
  defineProps<{
    original: string;
    modified: string;
    language?: string;
    sideBySide?: boolean;
  }>(),
  {
    language: "plaintext",
    sideBySide: false,
  },
);

const emit = defineEmits<{
  /**
   * Emitted after Monaco computes diff line changes. Provides the raw
   * ILineChange[] from DiffEditor.getLineChanges() for hunk extraction.
   */
  hunksReady: [changes: ILineChange[]];
}>();

const containerEl = ref<HTMLElement | null>(null);

let monacoInstance: typeof import("monaco-editor") | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any = null;
let disposed = false;
let diffUpdateDisposable: { dispose(): void } | null = null;

const mountedApps: App[] = [];

async function initEditor() {
  if (!containerEl.value || disposed) return;
  monacoInstance = await loader.init();
  if (disposed || !containerEl.value) return;

  editor = monacoInstance.editor.createDiffEditor(containerEl.value, {
    renderSideBySide: props.sideBySide,
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    theme: "vs",
  });

  applyModels();
}

function applyModels() {
  if (!editor || !monacoInstance) return;
  // Dispose previous diff listener to prevent accumulation
  diffUpdateDisposable?.dispose();

  // IMPORTANT: register the listener BEFORE calling setModel.
  // Monaco fires onDidUpdateDiff synchronously during setModel when the diff is
  // trivial (e.g. new files with only additions). If we registered after, we'd
  // miss the event and never emit hunksReady for those files.
  diffUpdateDisposable = editor.onDidUpdateDiff(() => {
    const changes: ILineChange[] = editor.getLineChanges() ?? [];
    emit("hunksReady", changes);
  });

  const lang = props.language;
  const oldModel = editor.getModel();
  editor.setModel({
    original: monacoInstance.editor.createModel(props.original, lang),
    modified: monacoInstance.editor.createModel(props.modified, lang),
  });
  // Dispose old models after setModel to avoid memory leaks
  oldModel?.original?.dispose();
  oldModel?.modified?.dispose();
}

watch(
  () => [props.original, props.modified],
  () => {
    if (editor) applyModels();
  },
);

watch(
  () => props.sideBySide,
  (val) => {
    if (editor) editor.updateOptions({ renderSideBySide: val });
  },
);

onMounted(() => {
  initEditor();
});

onBeforeUnmount(() => {
  disposed = true;
  diffUpdateDisposable?.dispose();
  for (const app of mountedApps) {
    try {
      app.unmount();
    } catch {
      /* ignore */
    }
  }
  mountedApps.length = 0;
  editor?.dispose();
});

defineExpose({
  getEditor: () => editor,
  registerApp: (app: App) => {
    mountedApps.push(app);
  },
  unregisterApp: (app: App) => {
    const idx = mountedApps.indexOf(app);
    if (idx !== -1) mountedApps.splice(idx, 1);
  },
  clearApps: () => {
    for (const app of mountedApps) {
      try {
        app.unmount();
      } catch {
        /* ignore */
      }
    }
    mountedApps.length = 0;
  },
});
</script>

<style scoped>
.monaco-diff-editor {
  width: 100%;
  height: 100%;
}
</style>
