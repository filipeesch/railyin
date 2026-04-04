<template>
  <Teleport to="body">
    <div v-if="reviewStore.isOpen" class="review-overlay">
      <!-- Header -->
      <div class="review-overlay__header">
        <span class="review-overlay__title">Code Review</span>

        <!-- Mode indicator / Start Review button -->
        <span v-if="reviewStore.mode === 'changes'" class="review-overlay__mode-badge">Changes</span>
        <span v-else class="review-overlay__mode-badge review-overlay__mode-badge--review">Review mode</span>

        <!-- Filter dropdown (visible in both modes) -->
        <Select
          v-model="reviewStore.filter"
          :options="filterOptions"
          option-label="label"
          option-value="value"
          size="small"
          class="review-overlay__filter"
        />

        <div class="review-overlay__header-actions">
          <Button size="small" severity="secondary" label="Refresh" @click="onRefresh" :loading="refreshing" />
          <Button
            v-if="reviewStore.mode === 'changes'"
            size="small"
            label="Start Review"
            @click="reviewStore.mode = 'review'"
          />
          <template v-else>
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
          </template>
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

        <!-- Diff + hunk actions panel -->
        <div class="review-overlay__diff-panel">
          <!-- File not selected -->
          <div v-if="!reviewStore.selectedFile" class="review-overlay__placeholder">
            Select a file to review
          </div>

          <!-- Loading diff -->
          <div v-else-if="diffLoading" class="review-overlay__placeholder">
            <i class="pi pi-spin pi-spinner" /> Loading diff…
          </div>

          <!-- Error -->
          <div v-else-if="diffError" class="review-overlay__placeholder review-overlay__error">
            <span>{{ diffError }}</span>
            <Button size="small" label="Reload" severity="secondary" @click="loadDiff(reviewStore.selectedFile)" />
          </div>

          <!-- Monaco diff + hunk action bars -->
          <div v-else class="review-overlay__diff-wrapper">
            <MonacoDiffEditor
              v-if="diffContent"
              :key="diffEditorKey"
              :original="diffContent.original"
              :modified="diffContent.modified"
              :language="guessLanguage(reviewStore.selectedFile)"
              :height="diffEditorHeight"
              @hunks-ready="onHunksReady"
            />

            <!-- Hunk action bars — one per parsed hunk from API response -->
            <div v-if="filteredHunks.length > 0" class="hunk-action-list">
              <div
                v-for="hunk in filteredHunks"
                :key="hunk.hash"
                class="hunk-action-bar"
                :class="`hunk-action-bar--${effectiveDecision(hunk)}`"
              >
                <div class="hunk-action-bar__meta">
                  Hunk {{ hunk.hunkIndex + 1 }} / {{ (diffContent?.hunks ?? []).length }}
                  <span class="hunk-action-bar__lines">
                    ±{{ hunk.modifiedStart }}–{{ hunk.modifiedEnd }}
                  </span>
                </div>

                <!-- Read-only mode: show decision badge -->
                <div v-if="reviewStore.mode === 'changes'" class="hunk-action-bar__readonly">
                  <span class="hunk-decision-badge" :class="`hunk-decision-badge--${effectiveDecision(hunk)}`">
                    {{ effectiveDecision(hunk) }}
                  </span>
                  <span v-if="hunk.humanComment" class="hunk-action-bar__readonly-comment">
                    {{ hunk.humanComment }}
                  </span>
                </div>

                <!-- Review mode: interactive buttons -->
                <template v-else>
                  <div class="hunk-action-bar__buttons">
                    <Button
                      size="small"
                      severity="success"
                      label="Accept"
                      :class="{ 'hunk-btn--active': effectiveDecision(hunk) === 'accepted' }"
                      :loading="savingHunk === hunk.hash && pendingDecision(hunk) === 'accepted'"
                      @click="onDecide(hunk, 'accepted', null)"
                    />
                    <Button
                      size="small"
                      severity="danger"
                      label="Reject"
                      :class="{ 'hunk-btn--active': effectiveDecision(hunk) === 'rejected' }"
                      :loading="rejectingHunk === hunk.hunkIndex"
                      @click="onReject(hunk)"
                    />
                    <Button
                      size="small"
                      severity="warn"
                      label="Change Request"
                      :class="{ 'hunk-btn--active': effectiveDecision(hunk) === 'change_request' }"
                      @click="onStartChangeRequest(hunk)"
                    />
                  </div>

                  <!-- Change request comment -->
                  <div v-if="effectiveDecision(hunk) === 'change_request'" class="hunk-action-bar__comment">
                    <Textarea
                      v-model="commentDrafts[hunk.hash]"
                      placeholder="Describe the change you want instead…"
                      :rows="2"
                      class="hunk-action-bar__textarea"
                      auto-resize
                      @blur="saveComment(hunk)"
                    />
                    <span v-if="!commentDrafts[hunk.hash]?.trim()" class="hunk-action-bar__comment-warn">
                      A comment is required for change requests
                    </span>
                  </div>

                  <!-- Reject error -->
                  <div v-if="rejectError[hunk.hunkIndex]" class="hunk-action-bar__reject-error">
                    {{ rejectError[hunk.hunkIndex] }}
                    <Button size="small" label="Reload" severity="secondary" @click="loadDiff(reviewStore.selectedFile)" />
                  </div>
                </template>
              </div>
            </div>

            <div v-else-if="(diffContent?.hunks ?? []).length > 0" class="review-overlay__placeholder review-overlay__placeholder--filtered">
              No hunks match the current filter.
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import { useReviewStore } from "../stores/review";
import { useTaskStore } from "../stores/task";
import { electroview } from "../rpc";
import ReviewFileList from "./ReviewFileList.vue";
import MonacoDiffEditor from "./MonacoDiffEditor.vue";
import type { FileDiffContent, HunkWithDecisions, HunkDecision } from "@shared/rpc-types";
import type { ILineChange } from "./MonacoDiffEditor.vue";

const reviewStore = useReviewStore();
const taskStore = useTaskStore();

// ——— State ———————————————————————————————————————————————————————————————

const diffContent = ref<FileDiffContent | null>(null);
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const diffEditorKey = ref(0);
const refreshing = ref(false);
const submitting = ref(false);
const rejectingHunk = ref<number | null>(null);
const rejectError = ref<Record<number, string>>({});
const commentDrafts = ref<Record<string, string>>({}); // keyed by hunk.hash
const savingHunk = ref<string | null>(null); // hash being saved

const diffEditorHeight = 520;

const filterOptions = [
  { label: "All", value: "all" },
  { label: "Unreviewed", value: "unreviewed" },
  { label: "Needs Action", value: "needs_action" },
  { label: "Accepted", value: "accepted" },
];

// ——— Derived from API hunks (not store) ——————————————————————————————————

function effectiveDecision(hunk: HunkWithDecisions): HunkDecision {
  const opt = reviewStore.optimisticUpdates.get(hunk.hash);
  if (opt) return opt.decision;
  return hunk.humanDecision;
}

function effectiveComment(hunk: HunkWithDecisions): string | null {
  const opt = reviewStore.optimisticUpdates.get(hunk.hash);
  if (opt) return opt.comment;
  return hunk.humanComment;
}

function pendingDecision(hunk: HunkWithDecisions): HunkDecision {
  return reviewStore.optimisticUpdates.get(hunk.hash)?.decision ?? hunk.humanDecision;
}

const allHunks = computed<HunkWithDecisions[]>(() => diffContent.value?.hunks ?? []);

const filteredHunks = computed<HunkWithDecisions[]>(() => {
  const f = reviewStore.filter;
  if (f === "all") return allHunks.value;
  return allHunks.value.filter((h) => {
    const d = effectiveDecision(h);
    if (f === "unreviewed") return d === "pending";
    if (f === "needs_action") return d === "change_request";
    if (f === "accepted") return d === "accepted";
    return true;
  });
});

// ——— canSubmit / pendingCount derived from ALL hunks across all files ———————
// For simplicity we derive from current file's hunks + optimistic updates.
// A full cross-file computation would require loading all files which is expensive;
// we flag based on what's loaded and the optimistic cache.

const pendingCount = computed(() => {
  return allHunks.value.filter((h) => effectiveDecision(h) === "pending").length;
});

const canSubmit = computed(() => {
  // Any change_request hunk must have a non-empty comment
  return allHunks.value.every((h) => {
    if (effectiveDecision(h) !== "change_request") return true;
    const comment = commentDrafts.value[h.hash] ?? effectiveComment(h);
    return !!comment?.trim();
  });
});

// ——— File list for sidebar ————————————————————————————————————————————————

const fileListItems = computed(() =>
  reviewStore.files.map((path) => ({ path })),
);

// ——— File selection ———————————————————————————————————————————————————————

async function onSelectFile(path: string) {
  reviewStore.selectedFile = path;
  await loadDiff(path);
}

async function loadDiff(path: string | null) {
  if (!path || !reviewStore.taskId) return;
  diffLoading.value = true;
  diffError.value = null;
  diffEditorKey.value++;
  try {
    diffContent.value = await electroview.rpc!.request["tasks.getFileDiff"]({
      taskId: reviewStore.taskId,
      filePath: path,
    });
    // Pre-populate comment drafts from API decisions
    for (const hunk of diffContent.value.hunks) {
      if (hunk.humanComment && !commentDrafts.value[hunk.hash]) {
        commentDrafts.value[hunk.hash] = hunk.humanComment;
      }
    }
  } catch {
    diffError.value = "Could not load diff for this file.";
  } finally {
    diffLoading.value = false;
  }
}

// ——— Monaco hunks signal (not used for state, but required by component) ————

function onHunksReady(_lineChanges: ILineChange[]) {
  // Hunk state comes from API (diffContent.value.hunks), not Monaco
}

// ——— Hunk decisions (write-through to DB) ————————————————————————————————

async function onDecide(hunk: HunkWithDecisions, decision: HunkDecision, comment: string | null) {
  if (!reviewStore.taskId || !reviewStore.selectedFile) return;

  // Optimistic update
  reviewStore.optimisticUpdates.set(hunk.hash, { decision, comment });
  savingHunk.value = hunk.hash;

  try {
    await electroview.rpc!.request["tasks.setHunkDecision"]({
      taskId: reviewStore.taskId,
      hunkHash: hunk.hash,
      filePath: reviewStore.selectedFile,
      decision,
      comment,
      originalStart: hunk.originalStart,
      modifiedStart: hunk.modifiedStart,
    });
    // On success, clear optimistic update (API response on next load will reflect it)
    reviewStore.optimisticUpdates.delete(hunk.hash);
    // Refresh to get authoritative state
    await loadDiff(reviewStore.selectedFile);
  } catch {
    // Revert optimistic update on error
    reviewStore.optimisticUpdates.delete(hunk.hash);
  } finally {
    if (savingHunk.value === hunk.hash) savingHunk.value = null;
  }
}

async function onReject(hunk: HunkWithDecisions) {
  if (!reviewStore.selectedFile || !reviewStore.taskId) return;
  rejectingHunk.value = hunk.hunkIndex;
  delete rejectError.value[hunk.hunkIndex];
  try {
    const newDiff = await electroview.rpc!.request["tasks.rejectHunk"]({
      taskId: reviewStore.taskId,
      filePath: reviewStore.selectedFile,
      hunkIndex: hunk.hunkIndex,
    });
    diffContent.value = newDiff;
    diffEditorKey.value++;
    await taskStore.refreshChangedFiles(reviewStore.taskId);
  } catch {
    rejectError.value[hunk.hunkIndex] =
      "Could not revert this hunk — the file has been modified manually.";
  } finally {
    rejectingHunk.value = null;
  }
}

function onStartChangeRequest(hunk: HunkWithDecisions) {
  if (!commentDrafts.value[hunk.hash]) {
    commentDrafts.value[hunk.hash] = hunk.humanComment ?? "";
  }
  // Optimistically mark as change_request (comment may still be empty)
  reviewStore.optimisticUpdates.set(hunk.hash, {
    decision: "change_request",
    comment: commentDrafts.value[hunk.hash] || null,
  });
}

async function saveComment(hunk: HunkWithDecisions) {
  await onDecide(hunk, "change_request", commentDrafts.value[hunk.hash] || null);
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

// ——— Auto-select first file when overlay opens ——————————————————————————

watch(
  () => reviewStore.isOpen,
  async (open) => {
    if (open && reviewStore.selectedFile) {
      await loadDiff(reviewStore.selectedFile);
    }
    if (!open) {
      diffContent.value = null;
      diffError.value = null;
      commentDrafts.value = {};
      rejectError.value = {};
    }
  },
);

watch(
  () => reviewStore.selectedFile,
  async (path) => {
    if (path && reviewStore.isOpen) await loadDiff(path);
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
  background: var(--p-surface-0, #fff);
  display: flex;
  flex-direction: column;
}

.review-overlay__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  background: var(--p-surface-50, #f8fafc);
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
  background: var(--p-surface-200, #e2e8f0);
  color: var(--p-text-muted-color, #64748b);
  margin-right: auto;
}

.review-overlay__mode-badge--review {
  background: var(--p-blue-100, #dbeafe);
  color: var(--p-blue-700, #1d4ed8);
}

.review-overlay__filter {
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
  overflow-y: auto;
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

.review-overlay__diff-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
}

/* ——— Hunk action bars ——————————————————————————————————————————————— */

.hunk-action-list {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
}

.hunk-action-bar {
  border-bottom: 1px solid var(--p-surface-100, #f1f5f9);
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hunk-action-bar--accepted {
  background: var(--p-green-50, #f0fdf4);
}

.hunk-action-bar--rejected {
  background: var(--p-red-50, #fef2f2);
}

.hunk-action-bar--change_request {
  background: var(--p-orange-50, #fff7ed);
}

.hunk-action-bar__meta {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  display: flex;
  gap: 8px;
}

.hunk-action-bar__lines {
  font-family: monospace;
}

.hunk-action-bar__buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.hunk-btn--active {
  outline: 2px solid currentColor;
}

.hunk-action-bar__comment {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hunk-action-bar__textarea {
  width: 100%;
  font-size: 0.82rem;
  resize: vertical;
}

.hunk-action-bar__comment-warn {
  font-size: 0.72rem;
  color: var(--p-orange-500, #f97316);
}

.hunk-action-bar__reject-error {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--p-red-500, #ef4444);
}

/* ——— Read-only mode decision display ——————————————————————————————— */

.hunk-action-bar__readonly {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hunk-decision-badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hunk-decision-badge--pending {
  background: var(--p-surface-200, #e2e8f0);
  color: var(--p-text-muted-color, #64748b);
}

.hunk-decision-badge--accepted {
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.hunk-decision-badge--rejected {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-700, #b91c1c);
}

.hunk-decision-badge--change_request {
  background: var(--p-orange-100, #ffedd5);
  color: var(--p-orange-700, #c2410c);
}

.hunk-action-bar__readonly-comment {
  font-size: 0.8rem;
  color: var(--p-text-color, #0f172a);
  font-style: italic;
}
</style>


