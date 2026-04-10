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
    reviewMode?: boolean;
    onRequestLineComment?: (lineStart: number, lineEnd: number) => void;
    theme?: string;
  }>(),
  {
    language: "plaintext",
    sideBySide: false,
    reviewMode: false,
    theme: "vs",
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

let glyphHoverDecorations: string[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let commentWidget: any = null;
let commentWidgetRange = { startLine: 0, endLine: 0 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showCommentWidget(modEditor: any, startLine: number, endLine: number) {
  commentWidgetRange = { startLine, endLine };
  if (commentWidget) {
    modEditor.layoutContentWidget(commentWidget);
    return;
  }
  const widgetDom = document.createElement("div");
  widgetDom.className = "line-comment-widget";
  widgetDom.textContent = "+ Add comment";
  widgetDom.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const { startLine: s, endLine: en } = commentWidgetRange;
    props.onRequestLineComment?.(s, en);
    hideCommentWidget(modEditor);
  });
  commentWidget = {
    getId: () => "line-comment-widget",
    getDomNode: () => widgetDom,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getPosition: () => ({ position: { lineNumber: commentWidgetRange.endLine, column: 1 }, preference: [2] }),
  };
  modEditor.addContentWidget(commentWidget);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hideCommentWidget(modEditor: any) {
  if (commentWidget) {
    modEditor.removeContentWidget(commentWidget);
    commentWidget = null;
  }
}

function registerReviewHandlers() {
  if (!editor || !monacoInstance) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modEditor = editor.getModifiedEditor() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const GLYPH = (monacoInstance as any).editor.MouseTargetType.GUTTER_GLYPH_MARGIN;

  modEditor.onMouseMove((e: any) => {
    if (!props.reviewMode) {
      glyphHoverDecorations = modEditor.deltaDecorations(glyphHoverDecorations, []);
      return;
    }
    if (e.target?.type === GLYPH && e.target.position) {
      const ln = e.target.position.lineNumber;
      glyphHoverDecorations = modEditor.deltaDecorations(glyphHoverDecorations, [{
        range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 },
        options: { glyphMarginClassName: "line-comment-glyph" },
      }]);
    } else {
      glyphHoverDecorations = modEditor.deltaDecorations(glyphHoverDecorations, []);
    }
  });

  modEditor.onMouseLeave(() => {
    glyphHoverDecorations = modEditor.deltaDecorations(glyphHoverDecorations, []);
  });

  modEditor.onMouseDown((e: any) => {
    if (!props.reviewMode) return;
    if (e.target?.type === GLYPH && e.target.position) {
      const ln = e.target.position.lineNumber;
      e.event.preventDefault();
      props.onRequestLineComment?.(ln, ln);
    }
  });

  modEditor.onDidChangeCursorSelection((e: any) => {
    if (!props.reviewMode) { hideCommentWidget(modEditor); return; }
    const sel = e.selection;
    if (sel && sel.startLineNumber !== sel.endLineNumber) {
      showCommentWidget(modEditor, sel.startLineNumber, sel.endLineNumber);
    } else {
      hideCommentWidget(modEditor);
    }
  });
}

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
    theme: props.theme,
    glyphMargin: true,
  });

  applyModels();
  registerReviewHandlers();
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

watch(
  () => props.theme,
  (val) => {
    if (monacoInstance) monacoInstance.editor.setTheme(val ?? "vs");
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
