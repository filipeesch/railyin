<template>
  <div ref="containerEl" class="monaco-diff-editor" :style="{ height: height + 'px' }" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
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
    height?: number;
  }>(),
  {
    language: "plaintext",
    height: 500,
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

async function initEditor() {
  if (!containerEl.value || disposed) return;
  monacoInstance = await loader.init();
  if (disposed || !containerEl.value) return;

  editor = monacoInstance.editor.createDiffEditor(containerEl.value, {
    renderSideBySide: true,
    readOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    theme: "vs-dark",
  });

  applyModels();
}

function applyModels() {
  if (!editor || !monacoInstance) return;
  const lang = props.language;
  editor.setModel({
    original: monacoInstance.editor.createModel(props.original, lang),
    modified: monacoInstance.editor.createModel(props.modified, lang),
  });

  // Wait for the diff computation then emit hunks
  editor.onDidUpdateDiff(() => {
    const changes: ILineChange[] = editor.getLineChanges() ?? [];
    emit("hunksReady", changes);
  });
}

watch(
  () => [props.original, props.modified],
  () => {
    if (editor) applyModels();
  },
);

onMounted(() => {
  initEditor();
});

onBeforeUnmount(() => {
  disposed = true;
  editor?.dispose();
});
</script>

<style scoped>
.monaco-diff-editor {
  width: 100%;
}
</style>
