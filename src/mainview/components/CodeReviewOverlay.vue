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
          @select="onSelectFile"
        />

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
            :original="displayOriginal"
            :modified="displayModified"
            :language="guessLanguage(reviewStore.selectedFile)"
            :side-by-side="sideBySide"
            :theme="isDark ? 'vs-dark' : 'vs'"
            @hunks-ready="onHunksReady"
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
import type { FileDiffContent, HunkWithDecisions, HunkDecision } from "@shared/rpc-types";
import type { ILineChange } from "./MonacoDiffEditor.vue";

const reviewStore = useReviewStore();
const taskStore = useTaskStore();
const { isDark } = useDarkMode();

// ——— State ———————————————————————————————————————————————————————————————

const diffContent = ref<FileDiffContent | null>(null);
const displayOriginal = ref<string>("");
const displayModified = ref<string>("");
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const refreshing = ref(false);
const submitting = ref(false);
const sideBySide = ref(false);
const currentPendingIdx = ref(0);
const pendingNavTarget = ref<"first" | "last" | null>(null);
const lastLineChanges = ref<ILineChange[]>([]);
const diffEditorRef = ref<InstanceType<typeof MonacoDiffEditor> | null>(null);

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

// Scroll position to restore after accept/reject re-renders the diff model.
// Set in onDecideHunk so the editor doesn't jump to top; consumed in onHunksReady.
let pendingScrollRestore: number | null = null;

// Flag set by loadDiff so that onHunksReady auto-scrolls Monaco to the first
// pending hunk when a file is freshly loaded (not after accept/reject rebuilds).
let isInitialFileLoad = false;

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

// ——— Display model ———————————————————————————————————————————————————————

function buildDisplayModel(): { displayOrig: string; displayMod: string } {
  if (!diffContent.value) return { displayOrig: "", displayMod: "" };

  const apiOrigLines = diffContent.value.original.split("\n");
  const apiModLines = diffContent.value.modified.split("\n");
  const displayOrigLines = [...apiOrigLines];
  const displayModLines = [...apiModLines];

  // Accept: replace original range with modified lines (bottom-to-top to preserve indices)
  const acceptedHunks = allHunks.value
    .filter((h) => effectiveDecision(h) === "accepted")
    .sort((a, b) => b.originalStart - a.originalStart);

  for (const hunk of acceptedHunks) {
    const replacement = apiModLines.slice(hunk.modifiedStart - 1, hunk.modifiedEnd);
    displayOrigLines.splice(hunk.originalStart - 1, hunk.originalEnd - hunk.originalStart + 1, ...replacement);
  }

  // Reject: replace modified range with original lines (bottom-to-top on modified)
  const rejectedHunks = allHunks.value
    .filter((h) => effectiveDecision(h) === "rejected")
    .sort((a, b) => b.modifiedStart - a.modifiedStart);

  for (const hunk of rejectedHunks) {
    const replacement = apiOrigLines.slice(hunk.originalStart - 1, hunk.originalEnd);
    displayModLines.splice(hunk.modifiedStart - 1, hunk.modifiedEnd - hunk.modifiedStart + 1, ...replacement);
  }

  return { displayOrig: displayOrigLines.join("\n"), displayMod: displayModLines.join("\n") };
}

// ——— ViewZone management —————————————————————————————————————————————————

function clearAllZones() {
  for (const [, record] of hunkZones) {
    record.observer?.disconnect();
  }
  const editor = diffEditorRef.value?.getEditor();
  if (editor) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    editor.getModifiedEditor().changeViewZones((accessor: any) => {
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
  diffEditorRef.value?.clearApps();
  hunkZones.clear();
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
  for (const [, record] of hunkZones) {
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

/**
 * Map each Monaco ILineChange to the best matching undecided git hunk, returning
 * one entry per ILineChange. This ensures every colored diff region gets its own
 * action bar — Monaco frequently splits a single git hunk into multiple ILineChange
 * blocks, which would otherwise leave the first block without a bar.
 *
 * Algorithm:
 * 1. Locate each git hunk's modified content in the CURRENT display model via text
 *    search (so decisions that shift line numbers are handled automatically).
 * 2. For each Monaco ILineChange, pick the hunk with the greatest line-range overlap
 *    in display-model space; fall back to nearest hunk by distance.
 * 3. Append entries for any hunk that had no overlapping ILineChange (pure deletions
 *    that only appear on the original side).
 */
function mapLineChangesToHunks(
  lineChanges: ILineChange[],
  undecidedHunks: HunkWithDecisions[],
): Array<{ afterLineNumber: number; hunk: HunkWithDecisions }> {
  if (!diffContent.value || undecidedHunks.length === 0) return [];

  const apiModLines = diffContent.value.modified.split("\n");
  const displayModLines = displayModified.value.split("\n");

  // For each hunk find [start, end] (1-indexed) in the current display model.
  const displayRange = new Map<string, { start: number; end: number }>();
  for (const hunk of undecidedHunks) {
    if (hunk.modifiedContentStart > 0 && hunk.modifiedContentEnd > 0) {
      const hunkLines = apiModLines.slice(hunk.modifiedContentStart - 1, hunk.modifiedContentEnd);
      let found = false;
      outer: for (let i = 0; i <= displayModLines.length - hunkLines.length; i++) {
        for (let j = 0; j < hunkLines.length; j++) {
          if (displayModLines[i + j] !== hunkLines[j]) continue outer;
        }
        displayRange.set(hunk.hash, { start: i + 1, end: i + hunkLines.length });
        found = true;
        break;
      }
      if (!found) {
        // Fallback: use raw API position (valid before any decisions shift lines)
        displayRange.set(hunk.hash, { start: hunk.modifiedContentStart, end: hunk.modifiedContentEnd });
      }
    } else {
      // Pure deletion — position is the insertion point in the modified editor
      displayRange.set(hunk.hash, { start: hunk.modifiedStart, end: hunk.modifiedStart });
    }
  }

  const result: Array<{ afterLineNumber: number; hunk: HunkWithDecisions }> = [];
  const matchedHashes = new Set<string>();

  for (const change of lineChanges) {
    const changeEnd = change.modifiedEndLineNumber > 0
      ? change.modifiedEndLineNumber
      : change.modifiedStartLineNumber;
    const changeStart = change.modifiedStartLineNumber > 0
      ? change.modifiedStartLineNumber
      : change.modifiedEndLineNumber;

    let bestHunk: HunkWithDecisions | null = null;
    let bestOverlap = -Infinity;
    let bestDist = Infinity;

    for (const hunk of undecidedHunks) {
      const r = displayRange.get(hunk.hash);
      if (!r) continue;
      const overlap = Math.min(changeEnd, r.end) - Math.max(changeStart, r.start) + 1;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestHunk = hunk;
        bestDist = 0;
      } else if (overlap === bestOverlap) {
        const dist = Math.min(Math.abs(changeStart - r.end), Math.abs(changeEnd - r.start));
        if (dist < bestDist) {
          bestDist = dist;
          bestHunk = hunk;
        }
      }
    }

    if (!bestHunk) continue;
    matchedHashes.add(bestHunk.hash);
    result.push({ afterLineNumber: changeEnd, hunk: bestHunk });
  }

  // Hunks with no matching ILineChange (pure-deletion hunks)
  for (const hunk of undecidedHunks) {
    if (matchedHashes.has(hunk.hash)) continue;
    const r = displayRange.get(hunk.hash);
    result.push({ afterLineNumber: Math.max(r?.start ?? hunk.modifiedStart, 1), hunk });
  }

  return result;
}

function injectViewZones(lineChanges: ILineChange[]) {
  // Changes mode shows a clean read-only diff — no action bars needed
  if (reviewStore.mode === "changes") return;

  const editor = diffEditorRef.value?.getEditor();
  if (!editor || !diffContent.value) return;

  const undecidedHunks = getVisibleUndecidedHunks();
  // One entry per Monaco ILineChange; multiple entries may share the same git hunk
  // when Monaco splits a single git hunk into several ILineChange regions.
  const entries = mapLineChangesToHunks(lineChanges, undecidedHunks);
  const modEditor = editor.getModifiedEditor();
  const origEditor = sideBySide.value ? editor.getOriginalEditor() : null;

  for (const { afterLineNumber, hunk } of entries) {
    // Key is composite to allow multiple zones per git hunk (Monaco split case).
    const zoneKey = `${hunk.hash}:${afterLineNumber}`;
    if (hunkZones.has(zoneKey)) continue; // deduplicate identical positions

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

// ——— Monaco diff ready → correlate + inject ViewZones ────────────────────

function onHunksReady(lineChanges: ILineChange[]) {
  lastLineChanges.value = lineChanges;
  clearAllZones();
  injectViewZones(lineChanges);

  // Force layout for all injected zones. Zones placed below the visible viewport
  // (e.g. the entire content of a new file) may not trigger ResizeObserver in
  // WKWebView, leaving their Monaco container at height:0. A forced layout pass
  // immediately after injection corrects this.
  nextTick(() => layoutAllZones());

  // Restore scroll after accept/reject rebuilds the diff model (setModel resets scroll to 0).
  // Only set during onDecideHunk — NOT during file navigation — so it never conflicts
  // with scrollToPendingHunk.
  if (pendingScrollRestore !== null) {
    const scroll = pendingScrollRestore;
    pendingScrollRestore = null;
    nextTick(() => {
      diffEditorRef.value?.getEditor()?.getModifiedEditor().setScrollTop(scroll);
    });
  }

  // After cross-file navigation, scroll to the first or last pending hunk in the new file
  if (pendingNavTarget.value !== null) {
    const target = pendingNavTarget.value;
    pendingNavTarget.value = null;
    isInitialFileLoad = false;
    nextTick(() => {
      currentPendingIdx.value = target === "first" ? 0 : Math.max(0, pendingHunks.value.length - 1);
      scrollToPendingHunk();
    });
    return;
  }

  // Initial file load: scroll Monaco to the first pending hunk so it is immediately
  // visible. This handles files where the first hunk is below the editor's default
  // scroll position (e.g. new/untracked files whose only change is at the last line).
  if (isInitialFileLoad && pendingScrollRestore === null && hunkZones.size > 0) {
    isInitialFileLoad = false;
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
      // Reject also reverts the file on disk
      const newDiff = await electroview.rpc!.request["tasks.rejectHunk"]({
        taskId: reviewStore.taskId,
        filePath: reviewStore.selectedFile,
        hunkIndex: hunk.hunkIndex,
      });
      diffContent.value = newDiff;
    } else {
      await electroview.rpc!.request["tasks.setHunkDecision"]({
        taskId: reviewStore.taskId,
        hunkHash: hash,
        filePath: reviewStore.selectedFile,
        decision,
        comment,
        originalStart: hunk.originalStart,
        modifiedStart: hunk.modifiedStart,
      });
    }

    reviewStore.optimisticUpdates.delete(hash);

    // Update in-memory hunk state so display model and canSubmit stay accurate.
    // Skip for "rejected": diffContent was replaced with newDiff which already has
    // correct decisions from DB (the rejected hunk is gone from the diff since the
    // file was reverted on disk). Mutating hunks[hunkIdx] would corrupt a different
    // hunk at that index position in the new array.
    if (decision !== "rejected") {
      diffContent.value.hunks[hunkIdx] = {
        ...diffContent.value.hunks[hunkIdx],
        humanDecision: decision,
        humanComment: comment,
      };
    }

    if (decision === "change_request") {
      // Diff stays visible — clear and re-inject zones at same positions
      clearAllZones();
      injectViewZones(lastLineChanges.value);
    } else {
      // Accept / Reject — rebuild display model to collapse the decided hunk.
      // Save scroll first: setModel inside applyModels resets Monaco scroll to 0.
      pendingScrollRestore = diffEditorRef.value?.getEditor()?.getModifiedEditor().getScrollTop() ?? null;
      clearAllZones();
      const { displayOrig, displayMod } = buildDisplayModel();
      displayOriginal.value = displayOrig;
      displayModified.value = displayMod;
      // Monaco prop watcher fires → applyModels → onDidUpdateDiff → onHunksReady → injectViewZones
    }

    if (reviewStore.taskId) {
      await taskStore.refreshChangedFiles(reviewStore.taskId);
    }
  } catch {
    reviewStore.optimisticUpdates.delete(hash);
  }
}

// ——— Navigation ——————————————————————————————————————————————————————————

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
  reviewStore.selectedFile = reviewStore.files[idx + 1];
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
  reviewStore.selectedFile = reviewStore.files[idx - 1];
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
  clearAllZones();
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
  reviewStore.selectedFile = path;
  await loadDiff(path);
}

async function loadDiff(path: string | null) {
  if (!path || !reviewStore.taskId) return;
  clearAllZones();
  currentPendingIdx.value = 0;
  isInitialFileLoad = true;
  diffLoading.value = true;
  diffError.value = null;
  try {
    diffContent.value = await electroview.rpc!.request["tasks.getFileDiff"]({
      taskId: reviewStore.taskId,
      filePath: path,
    });
    const { displayOrig, displayMod } = buildDisplayModel();
    displayOriginal.value = displayOrig;
    displayModified.value = displayMod;
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
    await electroview.rpc!.request["tasks.sendMessage"]({
      taskId: reviewStore.taskId,
      content: JSON.stringify({ _type: "code_review" }),
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
    if (open && reviewStore.selectedFile) {
      await loadDiff(reviewStore.selectedFile);
    }
    if (!open) {
      clearAllZones();
      diffContent.value = null;
      diffError.value = null;
      displayOriginal.value = "";
      displayModified.value = "";
    }
  },
);

watch(
  () => reviewStore.selectedFile,
  async (path) => {
    if (path && reviewStore.isOpen) await loadDiff(path);
  },
);

watch(
  () => reviewStore.filter,
  () => {
    clearAllZones();
    injectViewZones(lastLineChanges.value);
  },
);

watch(
  () => reviewStore.mode,
  () => {
    clearAllZones();
    injectViewZones(lastLineChanges.value);
  },
);

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


