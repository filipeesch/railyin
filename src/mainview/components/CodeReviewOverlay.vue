<template>
  <Teleport to="body">
    <div v-if="reviewStore.isOpen" class="review-overlay">
      <!-- Header -->
      <div class="review-overlay__header">
        <span class="review-overlay__title">Code Review</span>

        <!-- Mode indicator -->
        <span v-if="reviewStore.mode === 'changes'" class="review-overlay__mode-badge">Changes</span>
        <span v-else class="review-overlay__mode-badge review-overlay__mode-badge--review">Review mode</span>

        <!-- Filter dropdown -->
        <Select
          v-model="reviewStore.filter"
          :options="filterOptions"
          option-label="label"
          option-value="value"
          size="small"
          class="review-overlay__filter"
          :pt="{ panel: { style: { zIndex: '1300' } } }"
        />

        <!-- Hunk navigation (review mode only) -->
        <div v-if="reviewStore.mode === 'review'" class="review-overlay__nav">
          <button class="nav-btn" :disabled="!canNavigatePrev" @click="navigatePrev">← Prev</button>
          <span class="nav-counter">{{ pendingHunks.length }} pending</span>
          <button class="nav-btn" :disabled="!canNavigateNext" @click="navigateNext">Next →</button>
        </div>

        <div class="review-overlay__header-actions">
          <!-- Inline / Side-by-side toggle -->
          <Button
            size="small"
            severity="secondary"
            :label="sideBySide ? '≡ Inline' : '⇔ Side by side'"
            @click="toggleViewMode"
          />

          <Button size="small" severity="secondary" label="Refresh" @click="onRefresh" :loading="refreshing" />

          <Button
            v-if="reviewStore.mode === 'review'"
            size="small"
            severity="secondary"
            label="View Changes"
            @click="reviewStore.mode = 'changes'"
          />

          <Button size="small" severity="secondary" icon="pi pi-times" rounded text @click="reviewStore.closeReview()" />
        </div>
      </div>

      <!-- Body -->
      <div class="review-overlay__body">
        <!-- File list panel -->
        <ReviewFileList
          :files="fileListItems"
          :selected-path="reviewStore.selectedFile"
          :style="{ width: fileListWidth + 'px' }"
          @select="onSelectFile"
        />

        <!-- Resizable splitter -->
        <div class="review-overlay__splitter" @mousedown.prevent="startSplitterDrag" />

        <!-- Diff panel — Monaco fills this entirely, ViewZones provide inline action bars -->
        <div class="review-overlay__diff-panel">
          <div v-if="!reviewStore.selectedFile" class="review-overlay__placeholder">
            Select a file to review
          </div>
          <div v-else-if="diffLoading" class="review-overlay__placeholder">
            <i class="pi pi-spin pi-spinner" /> Loading diff…
          </div>
          <div v-else-if="diffError" class="review-overlay__placeholder review-overlay__error">
            <span>{{ diffError }}</span>
            <Button size="small" label="Reload" severity="secondary" @click="loadDiff(reviewStore.selectedFile)" />
          </div>
          <MonacoDiffEditor
            v-else-if="diffContent"
            ref="diffEditorRef"
            :original="diffContent.original"
            :modified="diffContent.modified"
            :language="guessLanguage(reviewStore.selectedFile)"
            :side-by-side="sideBySide"
            :enable-comments="true"
            :on-request-line-comment="onRequestLineComment"
            :theme="isDark ? 'vs-dark' : 'vs'"
            @hunks-ready="onHunksReady"
            @content-change="onContentChange"
          />
        </div>
      </div>

      <!-- Footer: submit (review mode only) -->
      <div v-if="reviewStore.mode === 'review'" class="review-overlay__footer">
        <span v-if="pendingCount > 0" class="review-overlay__pending-warning">
          {{ pendingCount }} undecided hunk{{ pendingCount !== 1 ? "s" : "" }}
        </span>
        <Button
          size="small"
          label="Submit Review"
          class="submit-review-btn"
          :disabled="!canSubmit || submitting"
          :loading="submitting"
          @click="onSubmit"
        />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, createApp } from "vue";
import { createPatch } from "diff";
import type { App } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import { useReviewStore } from "../stores/review";
import { useTaskStore } from "../stores/task";
import { electroview } from "../rpc";
import { useDarkMode } from "../composables/useDarkMode";
import ReviewFileList from "./ReviewFileList.vue";
import MonacoDiffEditor from "./MonacoDiffEditor.vue";
import HunkActionBar from "./HunkActionBar.vue";
import LineCommentBar from "./LineCommentBar.vue";
import type {
  FileDiffContent,
  HunkWithDecisions,
  HunkDecision,
  LineComment,
  ManualEdit,
} from "@shared/rpc-types";
import type { ILineChange } from "./MonacoDiffEditor.vue";

const reviewStore = useReviewStore();
const taskStore = useTaskStore();
const { isDark } = useDarkMode();

// ——— State ———————————————————————————————————————————————————————————————

const diffContent = ref<FileDiffContent | null>(null);
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const refreshing = ref(false);
const submitting = ref(false);
const sideBySide = ref(false);
const currentPendingIdx = ref(0);
const pendingNavTarget = ref<"first" | "last" | null>(null);
const lastLineChanges = ref<ILineChange[]>([]);
const diffEditorRef = ref<InstanceType<typeof MonacoDiffEditor> | null>(null);

// ——— Per-session fully-decided file tracking (for skip navigation) ——————————
// Tracks files where all pending hunks were decided this session.
// Using a plain Set (not reactive) — only read inside navigateToNextFile().
const fullyDecidedFiles = new Set<string>();

// Tracks which accepted-hunk hashes have been collapsed in the original model.
// Used as a guard to prevent onDidUpdateDiff → onHunksReady → collapseAcceptedHunks loops.
let lastCollapsedHashes = new Set<string>();

// ——— Resizable file list panel ——————————————————————————————————————————

const STORAGE_KEY_FILE_LIST_WIDTH = "railyn:review-file-list-width";
const fileListWidth = ref<number>(
  Number(localStorage.getItem(STORAGE_KEY_FILE_LIST_WIDTH)) || 220,
);
function startSplitterDrag(e: MouseEvent) {
  const startX = e.clientX;
  const startWidth = fileListWidth.value;

  function onMouseMove(ev: MouseEvent) {
    const delta = ev.clientX - startX;
    fileListWidth.value = Math.min(500, Math.max(150, startWidth + delta));
  }

  function onMouseUp() {
    localStorage.setItem(STORAGE_KEY_FILE_LIST_WIDTH, String(fileListWidth.value));
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

// ——— Edit tracking (live-save to disk) ——————————————————————————————————

const editedContent = ref(new Map<string, string>());
const editedFiles = ref(new Set<string>());
const editBaseContent = ref(new Map<string, string>());
let writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWriteFile: string | null = null;
let pendingWriteContent: string | null = null;

function onContentChange(value: string) {
  const filePath = reviewStore.selectedFile;
  if (!filePath || !reviewStore.taskId) return;
  editedContent.value.set(filePath, value);
  editedFiles.value.add(filePath);
  pendingWriteFile = filePath;
  pendingWriteContent = value;
  if (writeDebounceTimer) clearTimeout(writeDebounceTimer);
  writeDebounceTimer = setTimeout(() => flushWrite(filePath, value), 500);
}

async function flushWrite(filePath: string, content: string) {
  if (!reviewStore.taskId) return;
  try {
    await electroview.rpc!.request["tasks.writeFile"]({
      taskId: reviewStore.taskId,
      filePath,
      content,
    });
  } catch { /* non-fatal — disk write failed */ }
  if (pendingWriteFile === filePath) {
    pendingWriteFile = null;
    pendingWriteContent = null;
  }
}

async function flushPendingWrite() {
  if (pendingWriteFile && pendingWriteContent !== null) {
    if (writeDebounceTimer) { clearTimeout(writeDebounceTimer); writeDebounceTimer = null; }
    await flushWrite(pendingWriteFile, pendingWriteContent);
  }
}

function buildManualEdits(): ManualEdit[] {
  const items: ManualEdit[] = [];
  for (const filePath of editedFiles.value) {
    const modified = editedContent.value.get(filePath);
    const base = editBaseContent.value.get(filePath);
    if (modified == null || base == null || modified === base) continue;
    items.push({
      filePath,
      unifiedDiff: createPatch(filePath, base, modified, "before-review-edit", "manual-edit"),
    });
  }
  return items;
}

// ——— Checkpoint ref ————————————————————————————————————————————————————

const checkpointRef = ref<string | null>(null);

// ——— ViewZone tracking ——————————————————————————————————————————————————

interface ZoneDescriptor {
  afterLineNumber: number;
  heightInPx: number;
  domNode: HTMLDivElement;
}

interface ZoneRecord {
  zoneId: string;
  spacerZoneId?: string;
  domNode: HTMLDivElement;
  zoneDescriptor: ZoneDescriptor;
  spacerDescriptor?: ZoneDescriptor;
  app: App;
  hash: string;
  afterLineNumber: number;
  observer?: ResizeObserver;
}

const hunkZones = new Map<string, ZoneRecord>();

// Separate map for line comment zones. Key = commentId (positive for posted, negative temp for open).
const commentZones = new Map<number, ZoneRecord & { commentId: number; lineStart: number; lineEnd: number }>();
let nextTempCommentId = -1; // decremented for each open comment zone before persisting

// Decoration IDs for decided hunk overlays; replaced on each applyDecisionDecorations call.
let modifiedDecisionDecorations: string[] = [];
let originalDecisionDecorations: string[] = [];

// ——— Static config ———————————————————————————————————————————————————————

const filterOptions = [
  { label: "All", value: "all" },
  { label: "Unreviewed", value: "unreviewed" },
  { label: "Needs Action", value: "needs_action" },
  { label: "Accepted", value: "accepted" },
];

// ——— Derived ————————————————————————————————————————————————————————————

const allHunks = computed<HunkWithDecisions[]>(() => diffContent.value?.hunks ?? []);

function effectiveDecision(hunk: HunkWithDecisions): HunkDecision {
  const opt = reviewStore.optimisticUpdates.get(hunk.hash);
  return opt ? opt.decision : hunk.humanDecision;
}

const pendingHunks = computed(() => allHunks.value.filter((h) => effectiveDecision(h) === "pending"));
const pendingCount = computed(() => pendingHunks.value.length);

const canNavigateNext = computed(() => {
  if (currentPendingIdx.value < pendingHunks.value.length - 1) return true;
  const idx = reviewStore.files.indexOf(reviewStore.selectedFile ?? "");
  return idx >= 0 && idx < reviewStore.files.length - 1;
});

const canNavigatePrev = computed(() => {
  if (currentPendingIdx.value > 0) return true;
  const idx = reviewStore.files.indexOf(reviewStore.selectedFile ?? "");
  return idx > 0;
});

const canSubmit = computed(() =>
  allHunks.value.every((h) => {
    if (effectiveDecision(h) !== "change_request") return true;
    return !!h.humanComment?.trim();
  }),
);

const fileListItems = computed(() => reviewStore.files.map((path) => ({ path })));

// ——— ViewZone management —————————————————————————————————————————————————

function clearAllZones() {
  clearHunkZones();
  clearCommentZones();
}

/** Remove only hunk action-bar zones — leaves comment zones intact. */
function clearHunkZones() {
  for (const [, record] of hunkZones) record.observer?.disconnect();
  const editor = diffEditorRef.value?.getEditor();
  if (editor) {
    const modEditor = editor.getModifiedEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modEditor.changeViewZones((accessor: any) => {
      for (const [, record] of hunkZones) accessor.removeZone(record.zoneId);
    });
    if (sideBySide.value) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.getOriginalEditor().changeViewZones((accessor: any) => {
        for (const [, record] of hunkZones) {
          if (record.spacerZoneId) accessor.removeZone(record.spacerZoneId);
        }
      });
    }
  }
  // Only unmount hunk-bar Vue apps (comment zones manage their own apps via commentZones map).
  for (const [, record] of hunkZones) {
    try { record.app.unmount(); } catch { /* ignore */ }
  }
  hunkZones.clear();
}

/** Remove only line-comment zones — leaves hunk action bars intact. */
function clearCommentZones() {
  for (const [, record] of commentZones) record.observer?.disconnect();
  const editor = diffEditorRef.value?.getEditor();
  if (editor) {
    const modEditor = editor.getModifiedEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modEditor.changeViewZones((accessor: any) => {
      for (const [, record] of commentZones) accessor.removeZone(record.zoneId);
    });
  }
  for (const [, record] of commentZones) {
    try { record.app.unmount(); } catch { /* ignore */ }
  }
  commentZones.clear();
}

function layoutZone(hash: string) {
  const editor = diffEditorRef.value?.getEditor();
  if (!editor) return;
  // Layout ALL zones that belong to this git hunk (there may be multiple when Monaco
  // splits one git hunk into several ILineChange regions).
  for (const [, record] of hunkZones) {
    if (record.hash !== hash) continue;
    // Read the actual rendered content height from the inner hunk-bar element.
    // Monaco sets an explicit height on domNode (the zone container), making
    // domNode.scrollHeight always equal to Monaco's allocated height rather than
    // the true content size. The first child is the Vue-mounted HunkActionBar.
    const innerEl = (record.domNode.firstElementChild as HTMLElement) ?? record.domNode;
    const actualHeight = Math.max(innerEl.scrollHeight, innerEl.offsetHeight) || record.domNode.scrollHeight;
    if (actualHeight > 0) {
      record.zoneDescriptor.heightInPx = actualHeight;
      if (record.spacerDescriptor) record.spacerDescriptor.heightInPx = actualHeight;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.getModifiedEditor().changeViewZones((accessor: any) => accessor.layoutZone(record.zoneId));
    if (record.spacerZoneId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.getOriginalEditor().changeViewZones((accessor: any) => accessor.layoutZone(record.spacerZoneId!));
    }
  }
}

/**
 * Force-layout every active zone. Called after injection so that zones placed
 * below the visible viewport (e.g. the bottom of a large new/untracked file)
 * still get their correct height set even if the ResizeObserver hasn't fired yet
 * (WKWebView may not notify for off-screen elements inside Monaco's container).
 *
 * When the inner element is off-screen its height reads as 0. We use a fallback
 * so Monaco allocates visible space; the ResizeObserver then corrects the height
 * once the zone scrolls into view.
 */
const FALLBACK_ZONE_HEIGHT_PX = 56; // approximate HunkActionBar height
function layoutAllZones() {
  const editor = diffEditorRef.value?.getEditor();
  if (!editor) return;
  const allRecords = [...hunkZones.values(), ...commentZones.values()];
  for (const record of allRecords) {
    const innerEl = (record.domNode.firstElementChild as HTMLElement) ?? record.domNode;
    const actualHeight =
      Math.max(innerEl.scrollHeight, innerEl.offsetHeight) ||
      record.domNode.scrollHeight ||
      FALLBACK_ZONE_HEIGHT_PX;
    if (actualHeight > 0) {
      record.zoneDescriptor.heightInPx = actualHeight;
      if (record.spacerDescriptor) record.spacerDescriptor.heightInPx = actualHeight;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.getModifiedEditor().changeViewZones((accessor: any) => accessor.layoutZone(record.zoneId));
    if (record.spacerZoneId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      editor.getOriginalEditor().changeViewZones((accessor: any) => accessor.layoutZone(record.spacerZoneId!));
    }
  }
}

function getVisibleUndecidedHunks(): HunkWithDecisions[] {
  const f = reviewStore.filter;
  return allHunks.value.filter((h) => {
    const d = effectiveDecision(h);
    if (f === "unreviewed") return d === "pending";
    if (f === "needs_action") return d === "change_request";
    if (f === "accepted") return false;
    return d === "pending" || d === "change_request";
  });
}

// ——— Per-hunk zone removal (for accept path) ———————————————————————————

function removeZoneForHash(hash: string) {
  const editor = diffEditorRef.value?.getEditor();
  const modEditor = editor?.getModifiedEditor();
  const origEditor = sideBySide.value ? editor?.getOriginalEditor() : null;
  for (const [key, record] of hunkZones) {
    if (record.hash !== hash) continue;
    record.observer?.disconnect();
    record.app.unmount();
    if (modEditor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modEditor.changeViewZones((accessor: any) => accessor.removeZone(record.zoneId));
    }
    if (record.spacerZoneId && origEditor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      origEditor.changeViewZones((accessor: any) => accessor.removeZone(record.spacerZoneId!));
    }
    hunkZones.delete(key);
  }
}

// ——— Decision decorations (Group 6) ——————————————————————————————————————

function applyDecisionDecorations() {
  const editor = diffEditorRef.value?.getEditor();
  if (!editor) return;
  const modEditor = editor.getModifiedEditor();
  const origEditor = sideBySide.value ? editor.getOriginalEditor() : null;
  const modifiedDecorations = allHunks.value
    .filter((h) => effectiveDecision(h) !== "pending" && h.modifiedStart > 0)
    .map((h) => {
      const accepted = effectiveDecision(h) === "accepted";
      const startLine = Math.max(h.modifiedStart, 1);
      const endLine = Math.max(h.modifiedEnd, h.modifiedStart, 1);
      return {
        range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER },
        options: {
          isWholeLine: true,
          className: accepted ? "accepted-hunk-decoration" : "rejected-hunk-decoration",
          inlineClassName: accepted ? "accepted-hunk-inline-decoration" : "rejected-hunk-inline-decoration",
          zIndex: accepted ? 20 : 10,
        },
      };
    });
  modifiedDecisionDecorations = modEditor.deltaDecorations(modifiedDecisionDecorations, modifiedDecorations);

  if (origEditor) {
    const originalDecorations = allHunks.value
      .filter((h) => effectiveDecision(h) !== "pending" && h.originalStart > 0)
      .map((h) => {
        const accepted = effectiveDecision(h) === "accepted";
        const startLine = Math.max(h.originalStart, 1);
        const endLine = Math.max(h.originalEnd, h.originalStart, 1);
        return {
          range: { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER },
          options: {
            isWholeLine: true,
            className: accepted ? "accepted-hunk-decoration" : "rejected-hunk-decoration",
            inlineClassName: accepted ? "accepted-hunk-inline-decoration" : "rejected-hunk-inline-decoration",
            zIndex: accepted ? 20 : 10,
          },
        };
      });
    originalDecisionDecorations = origEditor.deltaDecorations(originalDecisionDecorations, originalDecorations);
  } else if (originalDecisionDecorations.length > 0) {
    originalDecisionDecorations = [];
  }
}

/**
 * Mutate the DiffEditor's original model so accepted hunks have identical text
 * on both sides. Monaco's diff engine recalculates and no longer highlights
 * those ranges, naturally removing red/green diff coloring.
 */
function collapseAcceptedHunks() {
  if (!diffContent.value) return;
  const accepted = diffContent.value.hunks.filter(
    (h) => effectiveDecision(h) === "accepted",
  );
  if (accepted.length === 0) return;

  const currentHashes = new Set(accepted.map((h) => h.hash));
  if (
    currentHashes.size === lastCollapsedHashes.size &&
    [...currentHashes].every((h) => lastCollapsedHashes.has(h))
  ) {
    return; // already collapsed this exact set — avoid onDidUpdateDiff loop
  }
  lastCollapsedHashes = currentHashes;

  const origModel = diffEditorRef.value?.getOriginalEditor()?.getModel();
  if (!origModel) return;

  // Rebuild original content with accepted hunks replaced by their modified text.
  // Use server content for stable line numbers (model may have been mutated before).
  const origLines = diffContent.value.original.split("\n");
  const modLines = diffContent.value.modified.split("\n");

  // Process bottom-to-top so earlier splices don't shift later hunks' indices.
  const sorted = [...accepted].sort((a, b) => b.originalStart - a.originalStart);
  for (const hunk of sorted) {
    const replacement =
      hunk.modifiedStart > 0 && hunk.modifiedEnd > 0
        ? modLines.slice(hunk.modifiedStart - 1, hunk.modifiedEnd)
        : [];

    if (hunk.originalStart === 0 && hunk.originalEnd === 0) {
      // Pure addition (new file): prepend modified content.
      origLines.splice(0, 0, ...replacement);
    } else {
      origLines.splice(
        hunk.originalStart - 1,
        hunk.originalEnd - hunk.originalStart + 1,
        ...replacement,
      );
    }
  }

  origModel.setValue(origLines.join("\n"));
}

function injectViewZones(lineChanges: ILineChange[]) {
  // Changes mode shows a clean read-only diff — no action bars needed
  if (reviewStore.mode === "changes") return;

  const editor = diffEditorRef.value?.getEditor();
  if (!editor || !diffContent.value) return;

  const undecidedHunks = getVisibleUndecidedHunks();
  const modEditor = editor.getModifiedEditor();
  const origEditor = sideBySide.value ? editor.getOriginalEditor() : null;

  // Build the injection list: one entry per bar to inject.
  // Strategy: map each Monaco ILineChange to the best-matching undecided git hunk so that
  // every colored diff region gets its own action bar.  Git's -U3 context merging can make
  // one git hunk span multiple Monaco ILineChanges; each Monaco ILineChange gets its own bar
  // but they share the same git hunk hash (so accepting/rejecting any bar decides the whole hunk).
  // Falls back to git-hunk-based injection for hunks not covered by any Monaco ILineChange
  // (e.g. pure-deletion hunks that only appear in the original editor).
  const injectionList: { hunk: HunkWithDecisions; afterLineNumber: number }[] = [];
  const hunksCoveredByMonaco = new Set<string>();

  if (lineChanges.length > 0 && undecidedHunks.length > 0) {
    for (const lc of lineChanges) {
      const modEnd = lc.modifiedEndLineNumber;
      const modStart = lc.modifiedStartLineNumber;
      // Find undecided git hunk whose modified range overlaps this Monaco ILineChange.
      const matchingHunk = undecidedHunks.find((h) => {
        const hStart = Math.min(h.modifiedStart, h.modifiedContentStart ?? h.modifiedStart);
        const hEnd = Math.max(h.modifiedEnd, h.modifiedContentEnd ?? h.modifiedEnd);
        return modStart <= hEnd && modEnd >= hStart;
      });
      if (matchingHunk) {
        hunksCoveredByMonaco.add(matchingHunk.hash);
        injectionList.push({
          hunk: matchingHunk,
          afterLineNumber: modEnd > 0 ? modEnd : Math.max(modStart, 1),
        });
      }
    }
  }

  // Include undecided hunks not matched by any Monaco ILineChange (e.g. pure-deletion hunks).
  for (const hunk of undecidedHunks) {
    if (!hunksCoveredByMonaco.has(hunk.hash)) {
      const afterLineNumber = hunk.modifiedEnd > 0 ? hunk.modifiedEnd : Math.max(hunk.modifiedStart, 1);
      injectionList.push({ hunk, afterLineNumber });
    }
  }

  for (const { hunk, afterLineNumber } of injectionList) {
    const zoneKey = `${hunk.hash}:${afterLineNumber}`;
    if (hunkZones.has(zoneKey)) continue; // deduplicate

    const domNode = document.createElement("div");
    // Ensure pointer events reach Vue-mounted content
    domNode.style.pointerEvents = "auto";
    // Lift above Monaco's .view-lines layer which sits on top of .view-zones in the DOM
    // and would otherwise intercept real mouse clicks (confirmed via elementFromPoint).
    domNode.style.position = "relative";
    domNode.style.zIndex = "1";
    // Prevent Monaco from seeing mousedown/pointerdown from our zone.
    // Monaco's _onMouseDown runs in bubble phase and may call setPointerCapture
    // (redirecting pointerup away from our buttons) or e.preventDefault()
    // (suppressing click in WebKit) if it misidentifies the coordinate target.
    domNode.addEventListener("mousedown", (e) => e.stopPropagation());
    domNode.addEventListener("pointerdown", (e) => e.stopPropagation());
    const app = createApp(HunkActionBar, {
      hunk,
      mode: reviewStore.mode,
      onDecide: onDecideHunk,
      onHeightChange: () => layoutZone(hunk.hash),
    });
    app.mount(domNode);
    diffEditorRef.value?.registerApp(app);

    let zoneId = "";
    let spacerZoneId = "";
    const initialHeight = 108;

    const zoneDescriptor: ZoneDescriptor = { afterLineNumber, heightInPx: initialHeight, domNode };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modEditor.changeViewZones((accessor: any) => {
      zoneId = accessor.addZone(zoneDescriptor);
    });

    let spacerDescriptor: ZoneDescriptor | undefined;
    if (origEditor) {
      const spacerNode = document.createElement("div");
      spacerDescriptor = { afterLineNumber, heightInPx: initialHeight, domNode: spacerNode };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      origEditor.changeViewZones((accessor: any) => {
        spacerZoneId = accessor.addZone(spacerDescriptor!);
      });
    }

    // ResizeObserver keeps Monaco's line offsets in sync as the textarea grows.
    // Watch the inner hunk-bar element (not domNode) because Monaco sets an explicit
    // height on domNode — observing it would never detect content growing beyond 108px.
    const observer = new ResizeObserver(() => layoutZone(hunk.hash));
    const observeTarget = (domNode.firstElementChild as HTMLElement) ?? domNode;
    observer.observe(observeTarget);

    hunkZones.set(zoneKey, {
      zoneId,
      spacerZoneId: spacerZoneId || undefined,
      domNode,
      zoneDescriptor,
      spacerDescriptor,
      app,
      hash: hunk.hash,
      afterLineNumber,
      observer,
    });
  }
}

// ——— Monaco diff ready → inject ViewZones and decorations ────────────────

function onHunksReady(lineChanges: ILineChange[]) {
  lastLineChanges.value = lineChanges;
  clearHunkZones();
  injectViewZones(lineChanges);

  // Force layout for all injected zones. Zones placed below the visible viewport
  // (e.g. the entire content of a new file) may not trigger ResizeObserver in
  // WKWebView, leaving their Monaco container at height:0. A forced layout pass
  // immediately after injection corrects this.
  nextTick(() => {
    layoutAllZones();
    applyDecisionDecorations();
    collapseAcceptedHunks();
  });

  // After cross-file navigation, scroll to the first or last pending hunk in the new file.
  if (pendingNavTarget.value !== null) {
    const target = pendingNavTarget.value;
    pendingNavTarget.value = null;
    nextTick(() => {
      currentPendingIdx.value = target === "first" ? 0 : Math.max(0, pendingHunks.value.length - 1);
      scrollToPendingHunk();
    });
    return;
  }

  // Scroll Monaco to the first pending hunk on every fresh load (initial file load or after reject).
  if (hunkZones.size > 0) {
    nextTick(() => {
      currentPendingIdx.value = 0;
      scrollToPendingHunk();
    });
  }
}

// ——— Hunk decision handler ————————————————————————————————————————————————

async function onDecideHunk(hash: string, decision: HunkDecision, comment: string | null) {
  if (!reviewStore.taskId || !reviewStore.selectedFile || !diffContent.value) return;

  const hunkIdx = diffContent.value.hunks.findIndex((h) => h.hash === hash);
  if (hunkIdx === -1) return;
  const hunk = diffContent.value.hunks[hunkIdx];

  reviewStore.optimisticUpdates.set(hash, { decision, comment });

  try {
    if (decision === "rejected") {
      // Reject also reverts the file on disk; new diff load triggers onHunksReady.
      const newDiff = await electroview.rpc!.request["tasks.rejectHunk"]({
        taskId: reviewStore.taskId,
        filePath: reviewStore.selectedFile,
        hunkIndex: hunk.hunkIndex,
      });
      diffContent.value = newDiff;
      // Clear stale bars immediately so the UI doesn't show orphaned action bars.
      // Do NOT call injectViewZones here — lastLineChanges holds pre-reject line
      // positions which no longer match the new diff. Monaco will fire onHunksReady
      // with correct new ILCs after it re-computes the updated diff.
      clearHunkZones();
      applyDecisionDecorations();
    } else {
      await electroview.rpc!.request["tasks.setHunkDecision"]({
        taskId: reviewStore.taskId,
        hunkHash: hash,
        filePath: reviewStore.selectedFile,
        decision,
        comment,
        originalStart: hunk.originalStart,
        originalEnd: hunk.originalEnd,
        modifiedStart: hunk.modifiedStart,
        modifiedEnd: hunk.modifiedEnd,
      });
    }

    reviewStore.optimisticUpdates.delete(hash);

    // Update in-memory hunk state so canSubmit stays accurate.
    // Skip for "rejected": diffContent was replaced with newDiff which already has
    // correct decisions from DB.
    if (decision !== "rejected") {
      diffContent.value.hunks[hunkIdx] = {
        ...diffContent.value.hunks[hunkIdx],
        humanDecision: decision,
        humanComment: comment,
      };
    }

    if (decision === "accepted") {
      // Remove the action bar zone for this hunk; apply accepted decoration.
      removeZoneForHash(hash);
      applyDecisionDecorations();
      // Mutate the original model so Monaco's diff engine sees no difference
      // for accepted hunks — their red/green coloring disappears naturally.
      collapseAcceptedHunks();
      const remainingPendingInFile = diffContent.value.hunks.filter((candidate) => effectiveDecision(candidate) === "pending").length;
      if (remainingPendingInFile > 0) {
        currentPendingIdx.value = Math.min(currentPendingIdx.value, remainingPendingInFile - 1);
        nextTick(() => scrollToPendingHunk());
      } else {
        // All hunks in this file decided — track it and advance to the next pending file.
        if (reviewStore.selectedFile) fullyDecidedFiles.add(reviewStore.selectedFile);
        navigateToNextFile();
      }
    } else if (decision === "change_request") {
      // Diff stays visible — clear and re-inject zones so visibility filter applies.
      clearHunkZones();
      injectViewZones(lastLineChanges.value);
      applyDecisionDecorations();
    }

    if (reviewStore.taskId) {
      await taskStore.refreshChangedFiles(reviewStore.taskId);
    }
  } catch {
    reviewStore.optimisticUpdates.delete(hash);
  }
}

// ——— Line comment lifecycle ————————————————————————————————————————————————

function injectCommentZone(
  commentId: number,
  lineStart: number,
  lineEnd: number,
  state: "open" | "posted",
  initialComment?: string,
) {
  const editor = diffEditorRef.value?.getEditor();
  if (!editor) return;
  const modEditor = editor.getModifiedEditor();

  const afterLineNumber = Math.max(lineEnd, 1);
  const domNode = document.createElement("div");
  domNode.style.pointerEvents = "auto";
  domNode.style.position = "relative";
  domNode.style.zIndex = "1";
  domNode.addEventListener("mousedown", (e) => e.stopPropagation());
  domNode.addEventListener("pointerdown", (e) => e.stopPropagation());

  const app = createApp(LineCommentBar, {
    lineStart,
    lineEnd,
    state,
    initialComment,
    onPost: async (comment: string) => {
      if (!reviewStore.taskId || !reviewStore.selectedFile) return;
      const modifiedLines = diffContent.value?.modified.split("\n") ?? [];
      const lineText = modifiedLines.slice(lineStart - 1, lineEnd);
      const contextStart = Math.max(0, lineStart - 4);
      const contextEnd = Math.min(modifiedLines.length, lineEnd + 3);
      const contextLines = modifiedLines.slice(contextStart, contextEnd);
      const saved = await electroview.rpc!.request["tasks.addLineComment"]({
        taskId: reviewStore.taskId,
        filePath: reviewStore.selectedFile,
        lineStart,
        lineEnd,
        lineText,
        contextLines,
        comment,
      });
      // Remap old temp zone to the persisted comment ID
      const oldRecord = commentZones.get(commentId);
      if (oldRecord) {
        commentZones.delete(commentId);
        commentZones.set(saved.id, { ...oldRecord, commentId: saved.id });
      }
      // Re-mount with posted state (update app props)
      app.unmount();
      domNode.innerHTML = "";
      const postedApp = createApp(LineCommentBar, {
        lineStart,
        lineEnd,
        state: "posted" as const,
        initialComment: comment,
        onPost: () => {},
        onCancel: () => {},
        onDelete: async () => { await handleDeleteComment(saved.id); },
      });
      postedApp.mount(domNode);
      diffEditorRef.value?.registerApp(postedApp);
      nextTick(() => layoutCommentZone(saved.id));
    },
    onCancel: () => {
      removeCommentZone(commentId);
    },
    onDelete: async () => {
      await handleDeleteComment(commentId);
    },
    onHeightChange: () => layoutCommentZone(commentId),
  });
  app.mount(domNode);
  diffEditorRef.value?.registerApp(app);

  const initialHeight = 80;
  const zoneDescriptor: ZoneDescriptor = { afterLineNumber, heightInPx: initialHeight, domNode };
  let zoneId = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modEditor.changeViewZones((accessor: any) => { zoneId = accessor.addZone(zoneDescriptor); });

  const observer = new ResizeObserver(() => layoutCommentZone(commentId));
  observer.observe((domNode.firstElementChild as HTMLElement) ?? domNode);

  commentZones.set(commentId, {
    zoneId,
    domNode,
    zoneDescriptor,
    app,
    hash: `comment:${commentId}`,
    afterLineNumber,
    observer,
    commentId,
    lineStart,
    lineEnd,
  });
}

function layoutCommentZone(commentId: number) {
  const record = commentZones.get(commentId);
  if (!record) return;
  const editor = diffEditorRef.value?.getEditor();
  if (!editor) return;
  const innerEl = (record.domNode.firstElementChild as HTMLElement) ?? record.domNode;
  const actualHeight = Math.max(innerEl.scrollHeight, innerEl.offsetHeight) || FALLBACK_ZONE_HEIGHT_PX;
  if (actualHeight > 0) record.zoneDescriptor.heightInPx = actualHeight;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor.getModifiedEditor().changeViewZones((accessor: any) => accessor.layoutZone(record.zoneId));
}

function removeCommentZone(commentId: number) {
  const record = commentZones.get(commentId);
  if (!record) return;
  record.observer?.disconnect();
  record.app.unmount();
  const editor = diffEditorRef.value?.getEditor();
  if (editor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.getModifiedEditor().changeViewZones((accessor: any) => accessor.removeZone(record.zoneId));
  }
  commentZones.delete(commentId);
}

async function handleDeleteComment(commentId: number) {
  if (!reviewStore.taskId) return;
  try {
    await electroview.rpc!.request["tasks.deleteLineComment"]({
      taskId: reviewStore.taskId,
      commentId,
    });
    removeCommentZone(commentId);
  } catch { /* ignore */ }
}

async function loadLineComments(filePath: string) {
  if (!reviewStore.taskId) return;
  try {
    const comments = await electroview.rpc!.request["tasks.getLineComments"]({
      taskId: reviewStore.taskId,
    });
    // Filter to this file and inject posted zones
    for (const lc of comments.filter((c: LineComment) => c.filePath === filePath)) {
      injectCommentZone(lc.id, lc.lineStart, lc.lineEnd, "posted", lc.comment);
    }
  } catch { /* ignore */ }
}

function onRequestLineComment(lineStart: number, lineEnd: number) {
  const tempId = nextTempCommentId--;
  injectCommentZone(tempId, lineStart, lineEnd, "open");
}

// ——— Navigation ——————————————————————————————————————————————————————————

/**
 * Advance to the next file that still has pending hunks.
 * Called when the last pending hunk in the current file is decided.
 * Skips files already fully decided this session (fullyDecidedFiles).
 */
function navigateToNextFile() {
  const idx = reviewStore.files.indexOf(reviewStore.selectedFile ?? "");
  if (idx < 0) return;
  for (let i = idx + 1; i < reviewStore.files.length; i++) {
    if (!fullyDecidedFiles.has(reviewStore.files[i])) {
      pendingNavTarget.value = "first";
      currentPendingIdx.value = 0;
      reviewStore.selectFile(reviewStore.files[i]);
      return;
    }
  }
  // No more pending files — stay on the current file.
}

function navigateNext() {
  if (currentPendingIdx.value < pendingHunks.value.length - 1) {
    currentPendingIdx.value++;
    scrollToPendingHunk();
    return;
  }
  // No more hunks in this file — move to next file
  const idx = reviewStore.files.indexOf(reviewStore.selectedFile ?? "");
  if (idx < 0 || idx >= reviewStore.files.length - 1) return;
  pendingNavTarget.value = "first";
  currentPendingIdx.value = 0;
  reviewStore.selectFile(reviewStore.files[idx + 1]);
}

function navigatePrev() {
  if (currentPendingIdx.value > 0) {
    currentPendingIdx.value--;
    scrollToPendingHunk();
    return;
  }
  // No more hunks before this in the file — move to prev file
  const idx = reviewStore.files.indexOf(reviewStore.selectedFile ?? "");
  if (idx <= 0) return;
  pendingNavTarget.value = "last";
  reviewStore.selectFile(reviewStore.files[idx - 1]);
}

function scrollToPendingHunk() {
  const hunk = pendingHunks.value[currentPendingIdx.value];
  if (!hunk) return;
  const editor = diffEditorRef.value?.getEditor();
  if (!editor) return;
  // Zones are keyed by `${hash}:${afterLineNumber}`; find the first (topmost) one for this hunk.
  let record: ZoneRecord | undefined;
  for (const [, r] of hunkZones) {
    if (r.hash !== hunk.hash) continue;
    if (!record || r.afterLineNumber < record.afterLineNumber) record = r;
  }
  // Fall back to the hunk's own start line when no ViewZone has been injected for it
  const line = record?.afterLineNumber ?? hunk.modifiedStart;
  editor.getModifiedEditor().revealLineInCenter(line);

  // After Monaco scrolls, check if the zone domNode is clipped above the editor
  // viewport (this happens for hunks near the top of the file where Monaco can't
  // center without going above its minimum scroll). Compensate by scrolling down.
  if (record) {
    requestAnimationFrame(() => {
      const domNode = record.domNode;
      const editorScrollable = domNode.closest(".monaco-scrollable-element");
      if (!editorScrollable) return;
      const editorRect = editorScrollable.getBoundingClientRect();
      const zoneRect = domNode.getBoundingClientRect();
      const clipAmount = editorRect.top - zoneRect.top;
      if (clipAmount > 0) {
        // Zone is partially above the editor — scroll Monaco down by clipAmount
        const modEditor = editor.getModifiedEditor();
        modEditor.setScrollTop(modEditor.getScrollTop() - clipAmount);
      }
      domNode.classList.add("hunk-bar--highlight");
      setTimeout(() => domNode.classList.remove("hunk-bar--highlight"), 600);
    });
  }
}

// ——— View mode toggle ————————————————————————————————————————————————————

async function toggleViewMode() {
  sideBySide.value = !sideBySide.value;
  clearHunkZones();
  await nextTick();
  // Monaco may or may not re-fire onDidUpdateDiff after updateOptions;
  // if zones are still empty after 120ms we inject manually
  setTimeout(() => {
    if (hunkZones.size === 0 && lastLineChanges.value.length > 0) {
      injectViewZones(lastLineChanges.value);
    }
  }, 120);
}

// ——— File loading ————————————————————————————————————————————————————————

async function onSelectFile(path: string) {
  reviewStore.selectFile(path);
  await loadDiff(path);
}

async function loadDiff(path: string | null) {
  if (!path || !reviewStore.taskId) return;
  await flushPendingWrite();
  lastCollapsedHashes = new Set();
  clearAllZones();
  currentPendingIdx.value = 0;
  diffLoading.value = true;
  diffError.value = null;
  try {
    diffContent.value = await electroview.rpc!.request["tasks.getFileDiff"]({
      taskId: reviewStore.taskId,
      filePath: path,
      ...(checkpointRef.value ? { checkpointRef: checkpointRef.value } : {}),
    });
    if (!editBaseContent.value.has(path) || !editedFiles.value.has(path)) {
      editBaseContent.value.set(path, diffContent.value.modified);
    }
    // Monaco prop watcher fires → applyModels → onDidUpdateDiff → onHunksReady
    // Load line comments for this file (injected as posted ViewZones)
    await loadLineComments(path);
    // WKWebView occasionally misses Monaco's initial onDidUpdateDiff event on fresh app boot.
    // Fall back to git-hunk-based bar injection so review mode remains usable.
    setTimeout(() => {
      if (
        reviewStore.isOpen &&
        reviewStore.mode === "review" &&
        diffContent.value?.hunks.length &&
        hunkZones.size === 0
      ) {
        clearHunkZones();
        injectViewZones([]);
        applyDecisionDecorations();
      }
    }, 180);
  } catch {
    diffError.value = "Could not load diff for this file.";
  } finally {
    diffLoading.value = false;
  }
}

// ——— Submit ——————————————————————————————————————————————————————————————

async function onSubmit() {
  if (!reviewStore.taskId || !canSubmit.value) return;
  submitting.value = true;
  try {
    await flushPendingWrite();
    const manualEdits = buildManualEdits();
    await electroview.rpc!.request["tasks.sendMessage"]({
      taskId: reviewStore.taskId,
      content: JSON.stringify({ _type: "code_review", manualEdits }),
    });
    reviewStore.closeReview();
  } finally {
    submitting.value = false;
  }
}

// ——— Refresh ————————————————————————————————————————————————————————————

async function onRefresh() {
  if (!reviewStore.taskId) return;
  refreshing.value = true;
  try {
    const newFiles = await electroview.rpc!.request["tasks.getChangedFiles"]({
      taskId: reviewStore.taskId,
    });
    reviewStore.openReview(reviewStore.taskId, newFiles);
    if (reviewStore.selectedFile) await loadDiff(reviewStore.selectedFile);
    await taskStore.refreshChangedFiles(reviewStore.taskId);
  } finally {
    refreshing.value = false;
  }
}

// ——— Watchers ————————————————————————————————————————————————————————————

watch(
  () => reviewStore.isOpen,
  async (open) => {
    if (open && reviewStore.taskId) {
      fullyDecidedFiles.clear();
      // Fetch the latest checkpoint ref so diffs are scoped to pending hunks.
      try {
        checkpointRef.value = await electroview.rpc!.request["tasks.getCheckpointRef"]({
          taskId: reviewStore.taskId,
        });
      } catch {
        checkpointRef.value = null;
      }
      if (reviewStore.selectedFile) await loadDiff(reviewStore.selectedFile);
    }
    if (!open) {
      fullyDecidedFiles.clear();
      await flushPendingWrite();
      clearAllZones();
      diffContent.value = null;
      diffError.value = null;
      editedContent.value.clear();
      editedFiles.value.clear();
      editBaseContent.value.clear();
      checkpointRef.value = null;
    }
  },
);

watch(
  () => reviewStore.selectedFile,
  async (path) => {
    if (path && reviewStore.isOpen) {
      await flushPendingWrite();
      await loadDiff(path);
    }
  },
);

watch(
  () => reviewStore.filter,
  () => {
    clearHunkZones();
    injectViewZones(lastLineChanges.value);
  },
);

watch(
  () => reviewStore.mode,
  () => {
    clearHunkZones();
    injectViewZones(lastLineChanges.value);
  },
);

// ——— Public API ——————————————————————————————————————————————————————————

defineExpose({ onRequestLineComment });

// ——— Helpers ————————————————————————————————————————————————————————————

function guessLanguage(path: string | null): string {
  if (!path) return "plaintext";
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    vue: "html",
    py: "python",
    rs: "rust",
    go: "go",
    json: "json",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    css: "css",
    html: "html",
  };
  return map[ext ?? ""] ?? "plaintext";
}
</script>

<style scoped>
.review-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: var(--p-content-background, #fff);
  display: flex;
  flex-direction: column;
}

.review-overlay__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  background: var(--p-content-background, #f8fafc);
}

.review-overlay__title {
  font-weight: 600;
  font-size: 1rem;
}

.review-overlay__mode-badge {
  font-size: 0.72rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--p-content-hover-background, #e2e8f0);
  color: var(--p-text-muted-color, #64748b);
  margin-right: auto;
}

.review-overlay__mode-badge--review {
  background: var(--p-blue-100, #dbeafe);
  color: var(--p-blue-700, #1d4ed8);
}.review-overlay__filter {
  min-width: 130px;
}

.review-overlay__pending-warning {
  font-size: 0.78rem;
  color: var(--p-orange-500, #f97316);
  font-weight: 500;
}

.review-overlay__header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.review-overlay__body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.review-overlay__splitter {
  width: 4px;
  flex-shrink: 0;
  background: var(--p-content-border-color, #e2e8f0);
  cursor: col-resize;
  transition: background 0.15s;
}

.review-overlay__splitter:hover,
.review-overlay__splitter:active {
  background: var(--p-primary-color, #6366f1);
}

.review-overlay__diff-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.review-overlay__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.9rem;
}

.review-overlay__placeholder--filtered {
  height: auto;
  padding: 24px;
}

.review-overlay__error {
  flex-direction: column;
  color: var(--p-red-500, #ef4444);
}

/* ——— Navigation ——————————————————————————————————————————————————— */

.review-overlay__nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 4px;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--p-content-border-color, #cbd5e1);
  background: var(--p-content-background, #fff);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: var(--p-text-color, #374151);
  transition: background 0.12s;
}

.nav-btn:hover:not(:disabled) {
  background: var(--p-content-hover-background, #f1f5f9);
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-counter {
  font-size: 12px;
  color: var(--p-text-muted-color, #64748b);
  white-space: nowrap;
}

/* ——— Footer ———————————————————————————————————————————————————————— */

.review-overlay__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--p-content-border-color, #e2e8f0);
  background: var(--p-content-background, #f8fafc);
}
</style>

<style>
html.dark-mode .review-overlay__mode-badge--review {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}
</style>
