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
          :aggregate-states="fileAggregateStates"
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
          <InlineReviewEditor
            v-else-if="diffContent"
            ref="inlineEditorRef"
            :modified="diffContent.modified"
            :original="diffContent.original"
            :hunks="diffContent.hunks"
            :language="guessLanguage(reviewStore.selectedFile)"
            :mode="reviewStore.mode"
            :enable-comments="true"
            :on-request-line-comment="onRequestLineComment"
            :on-decide-hunk="onDecideHunk"
            :theme="isDark ? 'vs-dark' : 'vs'"
            @content-change="onContentChange"
            @hunks-rendered="onHunksRendered"
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

    <!-- Pending-hunks confirmation dialog -->
    <Dialog
      v-model:visible="showPendingDialog"
      header="Pending Review"
      :modal="true"
      :closable="true"
      :style="{ width: '400px' }"
    >
      <p>{{ pendingDialogCount }} file{{ pendingDialogCount !== 1 ? "s" : "" }} still pending review. Submit anyway?</p>
      <template #footer>
        <Button label="Cancel" severity="secondary" size="small" @click="showPendingDialog = false" />
        <Button label="Submit Anyway" severity="warn" size="small" @click="doSubmit" />
      </template>
    </Dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { createPatch } from "diff";
import Button from "primevue/button";
import Select from "primevue/select";
import Dialog from "primevue/dialog";
import { useReviewStore } from "../stores/review";
import { useTaskStore } from "../stores/task";
import { electroview } from "../rpc";
import { useDarkMode } from "../composables/useDarkMode";
import ReviewFileList from "./ReviewFileList.vue";
import InlineReviewEditor from "./InlineReviewEditor.vue";
import type {
  FileDiffContent,
  HunkWithDecisions,
  HunkDecision,
  LineComment,
  ManualEdit,
} from "@shared/rpc-types";

const reviewStore = useReviewStore();
const taskStore = useTaskStore();
const { isDark } = useDarkMode();

// ——— State ———————————————————————————————————————————————————————————————

const diffContent = ref<FileDiffContent | null>(null);
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const refreshing = ref(false);
const submitting = ref(false);
const showPendingDialog = ref(false);
const pendingDialogCount = ref(0);
const currentPendingIdx = ref(0);
const pendingNavTarget = ref<"first" | "last" | null>(null);
const inlineEditorRef = ref<InstanceType<typeof InlineReviewEditor> | null>(null);

// ——— Per-session fully-decided file tracking (for skip navigation) ——————————
// Tracks files where all pending hunks were decided this session.
// Using a plain Set (not reactive) — only read inside navigateToNextFile().
const fullyDecidedFiles = new Set<string>();

// ——— Aggregate file states for file list dots ————————————————————————————
const fileAggregateStates = ref<Record<string, HunkDecision | "pending">>({});

function computeFileAggregateState(hunks: HunkWithDecisions[]): HunkDecision | "pending" {
  // Priority: pending > change_request > rejected > accepted
  let hasChangeRequest = false;
  let hasRejected = false;
  for (const h of hunks) {
    const d = effectiveDecision(h);
    if (d === "pending") return "pending";
    if (d === "change_request") hasChangeRequest = true;
    if (d === "rejected") hasRejected = true;
  }
  if (hasChangeRequest) return "change_request";
  if (hasRejected) return "rejected";
  return "accepted";
}

function updateCurrentFileAggregateState() {
  if (!reviewStore.selectedFile || !diffContent.value) return;
  fileAggregateStates.value = {
    ...fileAggregateStates.value,
    [reviewStore.selectedFile]: computeFileAggregateState(diffContent.value.hunks),
  };
}


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

// ——— ViewZone management (delegated to InlineReviewEditor) ——————————————

function clearAllZones() {
  inlineEditorRef.value?.clearAllHunkVisuals();
  inlineEditorRef.value?.clearCommentZones();
}

// Separate map for tracking comment metadata (for lifecycle management from overlay).
// Key = commentId (positive for posted, negative temp for open).
let nextTempCommentId = -1;

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

// ——— Inline editor callback: hunks rendered ——————————————————————————————

function onHunksRendered() {
  reviewStore.bumpVersion();

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

  // On initial file load: scroll to first pending hunk
  if (pendingHunks.value.length > 0) {
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
      // Reject also reverts the file on disk; reload the diff entirely.
      const newDiff = await electroview.rpc!.request["tasks.rejectHunk"]({
        taskId: reviewStore.taskId,
        filePath: reviewStore.selectedFile,
        hunkIndex: hunk.hunkIndex,
      });
      diffContent.value = newDiff;
      // InlineReviewEditor will re-render via hunks prop change + hunksRendered event.
      inlineEditorRef.value?.setContent(newDiff.modified);
      inlineEditorRef.value?.renderHunks(newDiff.hunks);
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
    reviewStore.bumpVersion();
    updateCurrentFileAggregateState();

    if (decision === "accepted") {
      // Remove this hunk's visual elements (deletion zone, insertion decorations, action bar).
      // No model mutation needed — editor already shows the accepted content.
      inlineEditorRef.value?.clearHunkVisuals(hash);
      const remainingPendingInFile = diffContent.value.hunks.filter((candidate) => effectiveDecision(candidate) === "pending").length;
      if (remainingPendingInFile > 0) {
        currentPendingIdx.value = Math.min(currentPendingIdx.value, remainingPendingInFile - 1);
      } else {
        // All hunks in this file decided — track it.
        if (reviewStore.selectedFile) fullyDecidedFiles.add(reviewStore.selectedFile);
      }
    } else if (decision === "change_request") {
      // Re-render hunks so visibility filter applies.
      inlineEditorRef.value?.renderHunks(diffContent.value.hunks);
    }

    if (reviewStore.taskId) {
      await taskStore.refreshChangedFiles(reviewStore.taskId);
    }
  } catch (err) {
    console.error("[onDecideHunk] RPC error for decision='" + decision + "' hash='" + hash + "':", err);
    reviewStore.optimisticUpdates.delete(hash);
  }
}

// ——— Line comment lifecycle ————————————————————————————————————————————————

async function handleDeleteComment(commentId: number) {
  if (!reviewStore.taskId) return;
  try {
    await electroview.rpc!.request["tasks.deleteLineComment"]({
      taskId: reviewStore.taskId,
      commentId,
    });
    inlineEditorRef.value?.removeCommentZone(commentId);
    inlineEditorRef.value?.removeCommentHighlight(commentId);
  } catch { /* ignore */ }
}

async function loadLineComments(filePath: string) {
  if (!reviewStore.taskId) return;
  try {
    const comments = await electroview.rpc!.request["tasks.getLineComments"]({
      taskId: reviewStore.taskId,
    });
    // Filter to this file and inject posted zones via InlineReviewEditor
    for (const lc of comments.filter((c: LineComment) => c.filePath === filePath)) {
      inlineEditorRef.value?.injectCommentZone(lc.id, lc.lineStart, lc.lineEnd, "posted", lc.comment, {
        onDelete: async () => { await handleDeleteComment(lc.id); },
      }, lc.colStart, lc.colEnd);
      // Add inline amber highlight for column-precise comments
      if (lc.colStart > 0 && lc.colEnd > 0) {
        inlineEditorRef.value?.addCommentHighlight(lc.id, lc.lineStart, lc.lineEnd, lc.colStart, lc.colEnd);
      }
    }
  } catch { /* ignore */ }
}

function onRequestLineComment(lineStart: number, lineEnd: number, colStart?: number, colEnd?: number) {
  const tempId = nextTempCommentId--;
  inlineEditorRef.value?.injectCommentZone(tempId, lineStart, lineEnd, "open", undefined, {
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
        colStart: colStart ?? 0,
        colEnd: colEnd ?? 0,
        lineText,
        contextLines,
        comment,
      });
      // Remount as posted state with the persisted comment ID
      inlineEditorRef.value?.remountCommentZone(tempId, saved.id, lineStart, lineEnd, comment, async () => {
        await handleDeleteComment(saved.id);
      });
      // Add inline amber highlight for column-precise comments
      if ((colStart ?? 0) > 0 && (colEnd ?? 0) > 0) {
        inlineEditorRef.value?.addCommentHighlight(saved.id, lineStart, lineEnd, colStart!, colEnd!);
      }
    },
    onCancel: () => {
      inlineEditorRef.value?.removeCommentZone(tempId);
    },
    onDelete: async () => {
      await handleDeleteComment(tempId);
    },
  }, colStart, colEnd);
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
  // Scroll to the hunk's modified line range and highlight the action bar.
  const line = hunk.modifiedContentEnd > 0
    ? hunk.modifiedContentEnd
    : hunk.modifiedEnd > 0
      ? hunk.modifiedEnd
      : Math.max(hunk.modifiedStart, 1);
  inlineEditorRef.value?.revealLine(line);
  nextTick(() => inlineEditorRef.value?.highlightActionBar(hunk.hash));
}

// ——— File loading ————————————————————————————————————————————————————————

async function onSelectFile(path: string) {
  reviewStore.selectFile(path);
  await loadDiff(path);
}

async function loadDiff(path: string | null) {
  if (!path || !reviewStore.taskId) return;
  await flushPendingWrite();
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
    // Wait for Vue to propagate new props (original, modified, hunks) to InlineReviewEditor,
    // then update the Monaco model and render zones.
    await nextTick();
    inlineEditorRef.value?.setContent(diffContent.value.modified);
    inlineEditorRef.value?.renderHunks(diffContent.value.hunks);
    // Load line comments for this file (injected as posted ViewZones).
    await loadLineComments(path);
    // Update aggregate state for file list dots.
    updateCurrentFileAggregateState();
  } catch {
    diffError.value = "Could not load diff for this file.";
  } finally {
    diffLoading.value = false;
  }
}

// ——— Submit ——————————————————————————————————————————————————————————————

async function onSubmit() {
  if (!reviewStore.taskId || !canSubmit.value) return;

  const manualEdits = buildManualEdits();
  const hasEdits = manualEdits.length > 0;

  // Compute pending/rejected/change_request state from local aggregate states.
  // Files not in fileAggregateStates are unvisited = pending.
  const allFiles = reviewStore.files;
  let pendingFileCount = 0;
  let hasRejections = false;
  let hasChangeRequests = false;
  for (const f of allFiles) {
    const path = typeof f === "string" ? f : f.path;
    const state = fileAggregateStates.value[path];
    if (!state || state === "pending") pendingFileCount++;
    if (state === "rejected") hasRejections = true;
    if (state === "change_request") hasChangeRequests = true;
  }

  // Silent close: every file fully accepted, no comments, no edits, no rejections.
  if (pendingFileCount === 0 && !hasEdits && !hasChangeRequests && !hasRejections) {
    reviewStore.closeReview();
    return;
  }

  // If pending files remain, show confirmation dialog.
  if (pendingFileCount > 0) {
    pendingDialogCount.value = pendingFileCount;
    showPendingDialog.value = true;
    return;
  }

  // All files decided (some rejected/change_request) or has edits — submit normally.
  await doSubmit();
}

async function doSubmit() {
  if (!reviewStore.taskId) return;
  showPendingDialog.value = false;
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
      // Initialize file list aggregate states.
      // Start with ALL review files as pending, then refine with DB data.
      try {
        const states: Record<string, HunkDecision | "pending"> = {};
        // Default all review files to pending.
        for (const f of reviewStore.files) {
          const path = typeof f === "string" ? f : f.path;
          states[path] = "pending";
        }
        // Refine with the summary of files that have any decisions.
        const summary = await electroview.rpc!.request["tasks.getPendingHunkSummary"]({
          taskId: reviewStore.taskId,
        });
        for (const { filePath, pendingCount } of summary) {
          states[filePath] = pendingCount > 0 ? "pending" : "accepted";
        }
        fileAggregateStates.value = states;
      } catch {
        // On error, default ALL files to pending.
        const states: Record<string, HunkDecision | "pending"> = {};
        for (const f of reviewStore.files) {
          const path = typeof f === "string" ? f : f.path;
          states[path] = "pending";
        }
        fileAggregateStates.value = states;
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
      fileAggregateStates.value = {};
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
    if (diffContent.value) {
      inlineEditorRef.value?.renderHunks(diffContent.value.hunks);
    }
  },
);

watch(
  () => reviewStore.mode,
  () => {
    if (diffContent.value) {
      inlineEditorRef.value?.renderHunks(diffContent.value.hunks);
    }
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
