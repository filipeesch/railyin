<template>
  <div ref="wrapperEl" style="position: relative; width: 100%; height: 100%">
    <div ref="containerEl" class="inline-review-editor" />
    <!-- Floating comment button (appears above text selection) -->
    <div
      v-if="floatingBtnVisible"
      class="inline-review-float-btn"
      :style="{ top: floatingBtnTop + 'px', left: floatingBtnLeft + 'px' }"
      @mousedown.prevent.stop="onFloatingBtnClick"
    >
      💬 Comment
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, createApp } from "vue";
import type { App } from "vue";
import loader from "@monaco-editor/loader";
import * as monaco from "monaco-editor";

// Use the local monaco-editor package instead of loading from CDN.
loader.config({ monaco });

// Disable language service workers (TS 7MB, HTML, CSS, JSON).
// The code review editor only needs syntax highlighting (tokenized on main thread).
// Worker creation in WKWebView (views:// protocol) is unreliable and can block
// the main thread for 10-30s when falling back to synchronous evaluation.
(self as any).MonacoEnvironment = {
  getWorker() {
    return undefined as any;
  },
};
import HunkActionBar from "./HunkActionBar.vue";
import LineCommentBar from "./LineCommentBar.vue";
import type {
  FileDiffContent,
  HunkWithDecisions,
  HunkDecision,
  LineComment,
} from "@shared/rpc-types";

// ——— Props & Emits ——————————————————————————————————————————————————————

const props = withDefaults(
  defineProps<{
    modified: string;
    original: string;
    hunks: HunkWithDecisions[];
    language?: string;
    mode: "changes" | "review";
    enableComments?: boolean;
    theme?: string;
    onRequestLineComment?: (lineStart: number, lineEnd: number, colStart?: number, colEnd?: number) => void;
    onDecideHunk?: (hash: string, decision: HunkDecision, comment: string | null) => void;
  }>(),
  {
    language: "plaintext",
    enableComments: false,
    theme: "vs",
  },
);

const emit = defineEmits<{
  contentChange: [value: string];
  hunksRendered: [];
}>();

// ——— Refs ———————————————————————————————————————————————————————————————

const containerEl = ref<HTMLElement | null>(null);

let monacoInstance: typeof import("monaco-editor") | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editor: any = null;
let disposed = false;

// ——— Zone Maps (Decision 5: three independent Maps) —————————————————————

interface ZoneConfig {
  afterLineNumber: number;
  heightInPx: number;
  domNode: HTMLDivElement;
  suppressMouseDown?: boolean;
}

interface ZoneRecord {
  zoneId: string;
  domNode: HTMLDivElement;
  zoneConfig: ZoneConfig;
  app?: App;
  hash?: string;
  observer?: ResizeObserver;
}

const deletionZones = new Map<string, ZoneRecord>();
const actionBarZones = new Map<string, ZoneRecord>();
const commentZones = new Map<number, ZoneRecord & { commentId: number; lineStart: number; lineEnd: number }>();

// Decoration IDs for insertion highlights (green bg)
let insertionDecorationIds: string[] = [];

// Comment highlight decorations (amber inline highlights for posted comments)
const commentHighlightDecorations = new Map<number, string[]>();

// Floating comment button state
const floatingBtnVisible = ref(false);
const floatingBtnTop = ref(0);
const floatingBtnLeft = ref(0);
const wrapperEl = ref<HTMLElement | null>(null);
let pendingSelectionStart = 0;
let pendingSelectionEnd = 0;
let pendingColStart = 0;
let pendingColEnd = 0;

// Track all mounted Vue apps
const mountedApps: App[] = [];

// Temp comment IDs
let nextTempCommentId = -1;

const FALLBACK_ZONE_HEIGHT_PX = 56;

// ——— Editor setup (Task 1.1) ————————————————————————————————————————————

async function initEditor() {
  if (!containerEl.value || disposed) return;
  monacoInstance = await loader.init();
  if (disposed || !containerEl.value) return;

  editor = monacoInstance.editor.create(containerEl.value, {
    value: props.modified,
    language: props.language,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    theme: props.theme,
    readOnly: false,
    glyphMargin: false,
    lineDecorationsWidth: 14,
  });

  // Content change handler
  editor.onDidChangeModelContent(() => {
    emit("contentChange", editor.getValue());
  });

  // Floating comment button — selection listener + scroll/escape hiders
  registerFloatingButtonHandlers();

  // Click handler for inline amber highlights (toggle comment zones)
  registerHighlightClickHandler();

  // Render initial hunks
  renderHunks(props.hunks);
}

// ——— Hunk rendering (Task 1.2) —————————————————————————————————————————

function renderHunks(hunks: HunkWithDecisions[]) {
  if (!editor || !monacoInstance) return;

  clearAllHunkVisuals();

  const insertionDecos: any[] = [];

  for (const hunk of hunks) {
    const decision = hunk.humanDecision;

    // Skip accepted/rejected hunks entirely (Task 2.4)
    if (decision === "accepted" || decision === "rejected") continue;

    const isChangeRequest = decision === "change_request";
    const isPending = decision === "pending";

    // 1. Deletion ViewZone — show original deleted lines (Task 1.2, 1.3)
    if (hunk.originalContentStart > 0 && hunk.originalContentEnd > 0) {
      const afterLineNumber = hunk.modifiedContentStart > 0
        ? hunk.modifiedContentStart - 1
        : Math.max(hunk.modifiedStart - 1, 0);

      const originalLines = props.original.split("\n");
      const deletedLines = originalLines.slice(
        hunk.originalContentStart - 1,
        hunk.originalContentEnd,
      );
      const deletedText = deletedLines.join("\n");
      const lineCount = deletedLines.length;

      createDeletionZone(hunk.hash, afterLineNumber, deletedText, lineCount);
    }

    // 2. Insertion ModelDecorations — green background on inserted lines (Task 1.2)
    if (hunk.modifiedContentStart > 0 && hunk.modifiedContentEnd > 0) {
      insertionDecos.push({
        range: {
          startLineNumber: hunk.modifiedContentStart,
          startColumn: 1,
          endLineNumber: hunk.modifiedContentEnd,
          endColumn: Number.MAX_SAFE_INTEGER,
        },
        options: {
          isWholeLine: true,
          className: "inline-review-insertion",
          minimap: { position: 1, color: "rgba(34, 197, 94, 0.4)" },
          overviewRuler: { position: 4, color: "rgba(34, 197, 94, 0.6)" },
        },
      });
    }

    // 3. Action bar ViewZone (Task 1.2)
    if (isPending || isChangeRequest) {
      const afterLine = hunk.modifiedContentEnd > 0
        ? hunk.modifiedContentEnd
        : hunk.modifiedEnd > 0
          ? hunk.modifiedEnd
          : Math.max(hunk.modifiedStart, 1);

      createActionBarZone(hunk, afterLine, isChangeRequest);
    }
  }

  // Apply all insertion decorations at once
  insertionDecorationIds = editor.deltaDecorations(insertionDecorationIds, insertionDecos);



  nextTick(() => {
    layoutAllZones();
    emit("hunksRendered");
  });
}

// ——— Deletion ViewZone (Task 1.2, 1.3) —————————————————————————————————

function createDeletionZone(hash: string, afterLineNumber: number, deletedText: string, lineCount: number) {
  if (!editor || !monacoInstance) return;

  const domNode = document.createElement("div");
  domNode.className = "inline-review-deletion-zone";
  domNode.style.pointerEvents = "none";

  // Render plain text first, then colorize async (Task 1.3)
  const preEl = document.createElement("pre");
  preEl.className = "inline-review-deletion-text";
  preEl.textContent = deletedText;
  domNode.appendChild(preEl);

  // Async syntax highlighting
  monacoInstance.editor.colorize(deletedText, props.language, { tabSize: 4 }).then(
    (html: string) => {
      if (disposed) return;
      preEl.innerHTML = html;
      preEl.classList.add("inline-review-deletion-text--colorized");
    },
    () => { /* fallback: keep plain text */ },
  );

  let zoneId = "";
  const lineHeight = editor.getOption(/* lineHeight */ 66) || 19;
  const heightInPx = lineCount * lineHeight;

  const zoneConfig: ZoneConfig = { afterLineNumber, heightInPx, domNode, suppressMouseDown: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => {
    zoneId = accessor.addZone(zoneConfig);
  });

  deletionZones.set(hash, { zoneId, domNode, zoneConfig });
}

// ——— Action Bar ViewZone (Task 1.2) —————————————————————————————————————

function createActionBarZone(hunk: HunkWithDecisions, afterLineNumber: number, isDecided: boolean) {
  if (!editor) return;

  const domNode = document.createElement("div");
  domNode.style.pointerEvents = "auto";
  domNode.style.position = "relative";
  domNode.style.zIndex = "1";

  // Keyboard isolation (Task 1.6)
  domNode.addEventListener("keydown", (e) => e.stopPropagation());
  domNode.addEventListener("keyup", (e) => e.stopPropagation());
  domNode.addEventListener("keypress", (e) => e.stopPropagation());
  // Prevent Monaco from stealing mouse events
  domNode.addEventListener("mousedown", (e) => e.stopPropagation());
  domNode.addEventListener("pointerdown", (e) => e.stopPropagation());

  const app = createApp(HunkActionBar, {
    hunk,
    mode: props.mode,
    onDecide: (hash: string, decision: HunkDecision, comment: string | null) => {
      props.onDecideHunk?.(hash, decision, comment);
    },
    onHeightChange: () => layoutActionBarZone(hunk.hash),
  });
  app.mount(domNode);
  mountedApps.push(app);

  let zoneId = "";
  const initialHeight = 108;
  const zoneConfig: ZoneConfig = { afterLineNumber, heightInPx: initialHeight, domNode };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => {
    zoneId = accessor.addZone(zoneConfig);
  });

  // ResizeObserver (Task 1.5) — guard prevents infinite layout ↔ resize cycles
  let lastObservedHeight = initialHeight;
  const observer = new ResizeObserver(() => {
    const el = (domNode.firstElementChild as HTMLElement) ?? domNode;
    const h = Math.max(el.scrollHeight, el.offsetHeight);
    if (h > 0 && h !== lastObservedHeight) {
      lastObservedHeight = h;
      layoutActionBarZone(hunk.hash);
    }
  });
  const observeTarget = (domNode.firstElementChild as HTMLElement) ?? domNode;
  observer.observe(observeTarget);

  actionBarZones.set(hunk.hash, {
    zoneId,
    domNode,
    zoneConfig,
    app,
    hash: hunk.hash,
    observer,
  });
}

// ——— Zone layout helpers ————————————————————————————————————————————————

function layoutActionBarZone(hash: string) {
  const record = actionBarZones.get(hash);
  if (!record || !editor) return;
  const innerEl = (record.domNode.firstElementChild as HTMLElement) ?? record.domNode;
  const actualHeight = Math.max(innerEl.scrollHeight, innerEl.offsetHeight) || FALLBACK_ZONE_HEIGHT_PX;
  if (actualHeight > 0) record.zoneConfig.heightInPx = actualHeight;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => accessor.layoutZone(record.zoneId));
}

function layoutCommentZone(commentId: number) {
  const record = commentZones.get(commentId);
  if (!record || !editor) return;
  const innerEl = (record.domNode.firstElementChild as HTMLElement) ?? record.domNode;
  const actualHeight = Math.max(innerEl.scrollHeight, innerEl.offsetHeight) || FALLBACK_ZONE_HEIGHT_PX;
  if (actualHeight > 0) record.zoneConfig.heightInPx = actualHeight;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => accessor.layoutZone(record.zoneId));
}

function layoutAllZones() {
  if (!editor) return;
  const allRecords = [
    ...deletionZones.values(),
    ...actionBarZones.values(),
    ...commentZones.values(),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => {
    for (const record of allRecords) {
      if (record.app) {
        const innerEl = (record.domNode.firstElementChild as HTMLElement) ?? record.domNode;
        const actualHeight =
          Math.max(innerEl.scrollHeight, innerEl.offsetHeight) ||
          record.domNode.scrollHeight ||
          FALLBACK_ZONE_HEIGHT_PX;
        if (actualHeight > 0) record.zoneConfig.heightInPx = actualHeight;
      }
      accessor.layoutZone(record.zoneId);
    }
  });
}

// ——— Zone clearing (Task 1.4) ———————————————————————————————————————————

/** Remove one hunk's deletion zone + insertion decorations + action bar zone */
function clearHunkVisuals(hash: string) {
  if (!editor) return;

  // Remove deletion zone
  const delRecord = deletionZones.get(hash);
  if (delRecord) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.changeViewZones((accessor: any) => accessor.removeZone(delRecord.zoneId));
    deletionZones.delete(hash);
  }

  // Remove action bar zone
  const abRecord = actionBarZones.get(hash);
  if (abRecord) {
    abRecord.observer?.disconnect();
    abRecord.app?.unmount();
    const idx = mountedApps.indexOf(abRecord.app!);
    if (idx !== -1) mountedApps.splice(idx, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.changeViewZones((accessor: any) => accessor.removeZone(abRecord.zoneId));
    actionBarZones.delete(hash);
  }

  // Re-compute insertion decorations (remove this hunk's lines)
  // We need to rebuild from the hunks prop minus this hash
  rebuildInsertionDecorations(hash);
}

function rebuildInsertionDecorations(excludeHash?: string) {
  if (!editor) return;
  const decos: any[] = [];
  for (const hunk of props.hunks) {
    if (excludeHash && hunk.hash === excludeHash) continue;
    const decision = hunk.humanDecision;
    if (decision === "accepted" || decision === "rejected") continue;
    if (hunk.modifiedContentStart > 0 && hunk.modifiedContentEnd > 0) {
      decos.push({
        range: {
          startLineNumber: hunk.modifiedContentStart,
          startColumn: 1,
          endLineNumber: hunk.modifiedContentEnd,
          endColumn: Number.MAX_SAFE_INTEGER,
        },
        options: {
          isWholeLine: true,
          className: "inline-review-insertion",
          minimap: { position: 1, color: "rgba(34, 197, 94, 0.4)" },
          overviewRuler: { position: 4, color: "rgba(34, 197, 94, 0.6)" },
        },
      });
    }
  }
  insertionDecorationIds = editor.deltaDecorations(insertionDecorationIds, decos);
}

/** Clear all hunk-related zones and decorations (Task 1.4) */
function clearAllHunkVisuals() {
  if (!editor) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => {
    for (const [, record] of deletionZones) accessor.removeZone(record.zoneId);
    for (const [, record] of actionBarZones) {
      record.observer?.disconnect();
      accessor.removeZone(record.zoneId);
    }
  });

  for (const [, record] of actionBarZones) {
    if (record.app) {
      record.app.unmount();
      const idx = mountedApps.indexOf(record.app);
      if (idx !== -1) mountedApps.splice(idx, 1);
    }
  }

  deletionZones.clear();
  actionBarZones.clear();

  // Clear insertion decorations
  insertionDecorationIds = editor.deltaDecorations(insertionDecorationIds, []);
}

/** Clear only comment zones (Task 1.4) */
function clearCommentZones() {
  if (!editor) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => {
    for (const [, record] of commentZones) {
      record.observer?.disconnect();
      accessor.removeZone(record.zoneId);
    }
  });
  for (const [, record] of commentZones) {
    if (record.app) {
      record.app.unmount();
      const idx = mountedApps.indexOf(record.app);
      if (idx !== -1) mountedApps.splice(idx, 1);
    }
  }
  commentZones.clear();
}

// ——— Floating comment button ————————————————————————————————————————————

function registerFloatingButtonHandlers() {
  if (!editor) return;

  editor.onDidChangeCursorSelection((e: any) => {
    if (!props.enableComments || props.mode !== "review") {
      floatingBtnVisible.value = false;
      return;
    }
    const sel = e.selection;
    if (!sel || (sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn)) {
      // Collapsed cursor — hide button
      floatingBtnVisible.value = false;
      return;
    }
    pendingSelectionStart = sel.startLineNumber;
    pendingSelectionEnd = sel.endLineNumber;
    pendingColStart = sel.startColumn;
    pendingColEnd = sel.endColumn;
    positionFloatingButton(sel.startLineNumber, sel.startColumn);
  });

  editor.onDidScrollChange(() => {
    // If there's a non-empty selection, re-position the button (scroll may have just made the
    // line visible after editor.setSelection() triggered auto-scroll).
    if (pendingSelectionStart > 0) {
      const sel = editor.getSelection();
      const hasNonEmpty = sel &&
        !(sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn);
      if (hasNonEmpty) {
        positionFloatingButton(pendingSelectionStart, pendingColStart);
        return;
      }
    }
    floatingBtnVisible.value = false;
  });

  editor.onKeyDown((e: any) => {
    if (e.keyCode === 9 /* Escape */) {
      floatingBtnVisible.value = false;
    }
  });
}

function positionFloatingButton(lineNumber: number, column: number) {
  if (!editor || !wrapperEl.value) return;
  const pos = editor.getScrolledVisiblePosition({ lineNumber, column });
  if (!pos) {
    floatingBtnVisible.value = false;
    return;
  }
  // Get the editor DOM node's offset within the wrapper
  const editorDom = editor.getDomNode();
  if (!editorDom) return;
  const editorRect = editorDom.getBoundingClientRect();
  const wrapperRect = wrapperEl.value.getBoundingClientRect();
  floatingBtnTop.value = pos.top + (editorRect.top - wrapperRect.top) - 30;
  floatingBtnLeft.value = pos.left + (editorRect.left - wrapperRect.left);
  floatingBtnVisible.value = true;
}

function onFloatingBtnClick() {
  floatingBtnVisible.value = false;
  props.onRequestLineComment?.(pendingSelectionStart, pendingSelectionEnd, pendingColStart, pendingColEnd);
}

// ——— Comment zones (exposed for parent) —————————————————————————————————

function injectCommentZone(
  commentId: number,
  lineStart: number,
  lineEnd: number,
  state: "open" | "posted",
  initialComment?: string,
  callbacks?: {
    onPost?: (comment: string) => Promise<void>;
    onCancel?: () => void;
    onDelete?: () => Promise<void>;
  },
  colStart?: number,
  colEnd?: number,
) {
  if (!editor) return;

  const afterLineNumber = Math.max(lineEnd, 1);
  const domNode = document.createElement("div");
  domNode.style.pointerEvents = "auto";
  domNode.style.position = "relative";
  domNode.style.zIndex = "1";

  // Keyboard isolation (Task 1.6)
  domNode.addEventListener("keydown", (e) => e.stopPropagation());
  domNode.addEventListener("keyup", (e) => e.stopPropagation());
  domNode.addEventListener("keypress", (e) => e.stopPropagation());
  domNode.addEventListener("mousedown", (e) => e.stopPropagation());
  domNode.addEventListener("pointerdown", (e) => e.stopPropagation());

  const app = createApp(LineCommentBar, {
    lineStart,
    lineEnd,
    colStart: colStart ?? 0,
    colEnd: colEnd ?? 0,
    state,
    initialComment,
    onPost: callbacks?.onPost ?? (() => {}),
    onCancel: callbacks?.onCancel ?? (() => {}),
    onDelete: callbacks?.onDelete ?? (() => {}),
    onHeightChange: () => layoutCommentZone(commentId),
  });
  app.mount(domNode);
  mountedApps.push(app);

  const initialHeight = 80;
  let zoneId = "";
  const zoneConfig: ZoneConfig = { afterLineNumber, heightInPx: initialHeight, domNode };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.changeViewZones((accessor: any) => {
    zoneId = accessor.addZone(zoneConfig);
  });

  const observer = new ResizeObserver(() => layoutCommentZone(commentId));
  observer.observe((domNode.firstElementChild as HTMLElement) ?? domNode);

  commentZones.set(commentId, {
    zoneId,
    domNode,
    zoneConfig,
    app,
    observer,
    commentId,
    lineStart,
    lineEnd,
  });
}

function remountCommentZone(
  oldCommentId: number,
  newCommentId: number,
  lineStart: number,
  lineEnd: number,
  comment: string,
  onDelete: () => Promise<void>,
) {
  const record = commentZones.get(oldCommentId);
  if (!record) return;
  commentZones.delete(oldCommentId);

  // Unmount old app
  record.app?.unmount();
  const idx = mountedApps.indexOf(record.app!);
  if (idx !== -1) mountedApps.splice(idx, 1);
  record.domNode.innerHTML = "";

  // Mount new posted app
  const postedApp = createApp(LineCommentBar, {
    lineStart,
    lineEnd,
    state: "posted" as const,
    initialComment: comment,
    onPost: () => {},
    onCancel: () => {},
    onDelete,
    onHeightChange: () => layoutCommentZone(newCommentId),
  });
  postedApp.mount(record.domNode);
  mountedApps.push(postedApp);

  commentZones.set(newCommentId, {
    ...record,
    app: postedApp,
    commentId: newCommentId,
  });

  nextTick(() => layoutCommentZone(newCommentId));
}

function removeCommentZone(commentId: number) {
  const record = commentZones.get(commentId);
  if (!record) return;
  record.observer?.disconnect();
  if (record.app) {
    record.app.unmount();
    const idx = mountedApps.indexOf(record.app);
    if (idx !== -1) mountedApps.splice(idx, 1);
  }
  if (editor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.changeViewZones((accessor: any) => accessor.removeZone(record.zoneId));
  }
  commentZones.delete(commentId);
}

// ——— Model update (for reject reload) ———————————————————————————————————

function setContent(modified: string) {
  if (!editor) return;
  editor.setValue(modified);
}

// ——— Navigation helpers —————————————————————————————————————————————————

function revealLine(lineNumber: number) {
  if (!editor) return;
  editor.revealLineInCenter(lineNumber);
}

function highlightActionBar(hash: string) {
  const record = actionBarZones.get(hash);
  if (!record) return;
  record.domNode.classList.add("hunk-bar--highlight");
  setTimeout(() => record.domNode.classList.remove("hunk-bar--highlight"), 600);
}

function getActionBarDomNode(hash: string): HTMLElement | null {
  return actionBarZones.get(hash)?.domNode ?? null;
}

// ——— Inline amber highlight for posted comments ————————————————————————

function addCommentHighlight(commentId: number, lineStart: number, lineEnd: number, colStart: number, colEnd: number) {
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const newDecos = editor.deltaDecorations([], [{
    range: {
      startLineNumber: lineStart,
      startColumn: colStart,
      endLineNumber: lineEnd,
      endColumn: colEnd,
    },
    options: {
      inlineClassName: "inline-review-comment-highlight",
      stickiness: 1, // TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
    },
  }]);
  commentHighlightDecorations.set(commentId, newDecos);
}

function removeCommentHighlight(commentId: number) {
  if (!editor) return;
  const decoIds = commentHighlightDecorations.get(commentId);
  if (decoIds) {
    editor.deltaDecorations(decoIds, []);
    commentHighlightDecorations.delete(commentId);
  }
}

function clearAllCommentHighlights() {
  if (!editor) return;
  for (const [, decoIds] of commentHighlightDecorations) {
    editor.deltaDecorations(decoIds, []);
  }
  commentHighlightDecorations.clear();
}

function registerHighlightClickHandler() {
  if (!editor) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.onMouseDown((e: any) => {
    const target = e.target?.element;
    if (!target) return;
    // Check if click is on a highlight decoration
    const el = target.closest?.(".inline-review-comment-highlight") ?? (target.classList?.contains("inline-review-comment-highlight") ? target : null);
    if (!el) return;
    // Find which comment this highlight belongs to by matching line position
    const pos = e.target?.position;
    if (!pos) return;
    for (const [commentId] of commentHighlightDecorations) {
      const record = commentZones.get(commentId);
      if (record && pos.lineNumber >= record.lineStart && pos.lineNumber <= record.lineEnd) {
        // Toggle: if zone exists, remove it; if not, we can't re-inject from here
        // (the zone is always injected — toggle its visibility)
        if (record.domNode.style.display === "none") {
          record.domNode.style.display = "";
          layoutCommentZone(commentId);
        } else {
          record.domNode.style.display = "none";
        }
        break;
      }
    }
  });
}

// ——— Watchers ———————————————————————————————————————————————————————————

watch(
  () => props.theme,
  (val) => {
    if (monacoInstance) monacoInstance.editor.setTheme(val ?? "vs");
  },
);

// ——— Lifecycle —————————————————————————————————————————————————————————

onMounted(() => {
  initEditor();
});

onBeforeUnmount(() => {
  disposed = true;
  clearAllCommentHighlights();
  // Task 1.7: unmount all Vue apps
  for (const app of mountedApps) {
    try { app.unmount(); } catch { /* ignore */ }
  }
  mountedApps.length = 0;
  editor?.dispose();
});

// ——— Expose ————————————————————————————————————————————————————————————

defineExpose({
  getEditor: () => editor,
  renderHunks,
  clearHunkVisuals,
  clearAllHunkVisuals,
  clearCommentZones,
  setContent,
  revealLine,
  highlightActionBar,
  getActionBarDomNode,
  injectCommentZone,
  remountCommentZone,
  removeCommentZone,
  addCommentHighlight,
  removeCommentHighlight,
  clearAllCommentHighlights,
  layoutAllZones,
});
</script>

<style scoped>
.inline-review-editor {
  width: 100%;
  height: 100%;
}
</style>

<style>
/* Insertion decoration — green background for added lines */
.inline-review-insertion {
  background: rgba(34, 197, 94, 0.12) !important;
  border-left: 2px solid rgba(34, 197, 94, 0.5);
}

/* Deletion ViewZone — red background for removed lines */
.inline-review-deletion-zone {
  background: rgba(239, 68, 68, 0.08);
  border-left: 2px solid rgba(239, 68, 68, 0.4);
  overflow-x: auto;
  overflow-y: hidden;
}

.inline-review-deletion-text {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-editor-font-family, "Menlo", "Monaco", "Courier New", monospace);
  font-size: var(--vscode-editor-font-size, 13px);
  line-height: var(--vscode-editor-line-height, 19px);
  white-space: pre;
  text-decoration: line-through;
  opacity: 0.7;
  color: var(--p-text-color, #374151);
}

.inline-review-deletion-text--colorized {
  /* When colorized HTML is injected, let Monaco's token classes control color */
  color: unset;
}

/* Floating comment button */
.inline-review-float-btn {
  position: absolute;
  z-index: 100;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.85);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  pointer-events: auto;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  transition: opacity 0.1s;
}
.inline-review-float-btn:hover {
  background: rgba(59, 130, 246, 1);
}

/* Inline amber highlight for posted comments with column-precise ranges */
.inline-review-comment-highlight {
  background: rgba(250, 204, 21, 0.15);
  cursor: pointer;
  border-radius: 2px;
}

/* Dark mode adjustments */
html.dark-mode .inline-review-insertion {
  background: rgba(34, 197, 94, 0.1) !important;
  border-left-color: rgba(34, 197, 94, 0.4);
}

html.dark-mode .inline-review-deletion-zone {
  background: rgba(239, 68, 68, 0.06);
  border-left-color: rgba(239, 68, 68, 0.3);
}

html.dark-mode .inline-review-deletion-text {
  color: var(--p-text-color, #e2e8f0);
}

html.dark-mode .inline-review-float-btn {
  background: rgba(96, 165, 250, 0.85);
}
html.dark-mode .inline-review-float-btn:hover {
  background: rgba(96, 165, 250, 1);
}

html.dark-mode .inline-review-comment-highlight {
  background: rgba(250, 204, 21, 0.10);
}
</style>
