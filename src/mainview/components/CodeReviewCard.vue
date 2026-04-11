<template>
  <div class="code-review-card">
    <div class="code-review-card__header" @click="expanded = !expanded">
      <span class="code-review-card__icon">🔍</span>
      <span class="code-review-card__title">Code Review</span>
      <div class="code-review-card__summary">
        <span v-if="stats.rejected > 0" class="badge badge--rejected">❌ {{ stats.rejected }} rejected</span>
        <span v-if="stats.change_request > 0" class="badge badge--change">📝 {{ stats.change_request }} change req.</span>
        <span v-if="lineCommentCount > 0" class="badge badge--comment">💬 {{ lineCommentCount }} comment{{ lineCommentCount !== 1 ? 's' : '' }}</span>
        <span v-if="manualEditCount > 0" class="badge badge--edit">✏️ {{ manualEditCount }} edit{{ manualEditCount !== 1 ? 's' : '' }}</span>
        <span v-if="!hasActionable" class="badge badge--accepted">✅ All accepted</span>
      </div>
      <span class="code-review-card__chevron">{{ expanded ? "▲" : "▼" }}</span>
    </div>

    <div v-if="expanded" class="code-review-card__body">
      <!-- No actionable items -->
      <div v-if="!hasActionable" class="code-review-card__empty">
        All changes were accepted. No action required.
      </div>

      <!-- Rejected / change_request hunks by file -->
      <template v-for="file in actionableFiles" :key="file.path">
        <div class="code-review-card__file">
          <div class="code-review-card__file-name" :title="file.path">{{ file.path }}</div>
          <div
            v-for="hunk in file.hunks"
            :key="hunk.hunkIndex"
            class="code-review-card__hunk"
            :class="`hunk--${hunk.decision}`"
          >
            <span class="hunk-decision">{{ decisionIcon(hunk.decision) }}</span>
            <span class="hunk-range">lines {{ hunk.modifiedRange[0] }}–{{ hunk.modifiedRange[1] }}</span>
            <span v-if="hunk.comment" class="hunk-comment">{{ hunk.comment }}</span>
          </div>
          <!-- Line comments on this file -->
          <div
            v-for="lc in file.lineComments"
            :key="lc.id"
            class="code-review-card__line-comment"
          >
            <span class="lc-icon">💬</span>
            <span class="lc-range">line{{ lc.lineStart !== lc.lineEnd ? 's' : '' }} {{ lc.lineStart }}{{ lc.lineStart !== lc.lineEnd ? `–${lc.lineEnd}` : '' }}</span>
            <span class="lc-text">{{ lc.comment }}</span>
          </div>
        </div>
      </template>

      <!-- Line comments on files with no actionable hunks -->
      <template v-for="file in commentOnlyFiles" :key="'c-' + file.path">
        <div class="code-review-card__file">
          <div class="code-review-card__file-name" :title="file.path">{{ file.path }}</div>
          <div
            v-for="lc in file.lineComments"
            :key="lc.id"
            class="code-review-card__line-comment"
          >
            <span class="lc-icon">💬</span>
            <span class="lc-range">line{{ lc.lineStart !== lc.lineEnd ? 's' : '' }} {{ lc.lineStart }}{{ lc.lineStart !== lc.lineEnd ? `–${lc.lineEnd}` : '' }}</span>
            <span class="lc-text">{{ lc.comment }}</span>
          </div>
        </div>
      </template>

      <!-- Manual edits section -->
      <div v-if="payload.manualEdits?.length" class="code-review-card__section">
        <div class="code-review-card__section-title">✏️ Manual Edits</div>
        <details
          v-for="edit in payload.manualEdits"
          :key="edit.filePath"
          class="code-review-card__edit-details"
        >
          <summary class="code-review-card__edit-summary">{{ edit.filePath }}</summary>
          <pre class="mini-diff">{{ edit.unifiedDiff }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { ConversationMessage, CodeReviewPayload, HunkDecision } from "@shared/rpc-types";

const props = defineProps<{ message: ConversationMessage }>();

const expanded = ref(false);

const payload = computed<CodeReviewPayload>(() => {
  try {
    return JSON.parse(props.message.content) as CodeReviewPayload;
  } catch {
    return { taskId: 0, files: [] };
  }
});

// Files with at least one rejected/change_request hunk or line comment
const actionableFiles = computed(() =>
  payload.value.files
    .map((f) => ({
      ...f,
      hunks: f.hunks.filter((h) => h.decision === "rejected" || h.decision === "change_request"),
    }))
    .filter((f) => f.hunks.length > 0 || (f.lineComments?.length ?? 0) > 0),
);

// Files that only have line comments (no rejected/change_request hunks) — avoid duplication
const actionableFilePaths = computed(() => new Set(actionableFiles.value.map((f) => f.path)));
const commentOnlyFiles = computed(() =>
  payload.value.files.filter(
    (f) =>
      !actionableFilePaths.value.has(f.path) &&
      (f.lineComments?.length ?? 0) > 0,
  ),
);

const stats = computed(() => {
  const counts = { rejected: 0, change_request: 0 };
  for (const file of payload.value.files) {
    for (const hunk of file.hunks) {
      if (hunk.decision === "rejected") counts.rejected++;
      else if (hunk.decision === "change_request") counts.change_request++;
    }
  }
  return counts;
});

const lineCommentCount = computed(() =>
  payload.value.files.reduce((sum, f) => sum + (f.lineComments?.length ?? 0), 0),
);

const manualEditCount = computed(() => payload.value.manualEdits?.length ?? 0);

const hasActionable = computed(
  () => stats.value.rejected > 0 || stats.value.change_request > 0 || lineCommentCount.value > 0 || manualEditCount.value > 0,
);

function decisionIcon(decision: HunkDecision): string {
  const icons: Record<HunkDecision, string> = {
    accepted: "✅",
    rejected: "❌",
    change_request: "📝",
    pending: "⬜",
  };
  return icons[decision];
}
</script>

<style scoped>
.code-review-card {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
  font-size: 0.85rem;
}

.code-review-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--p-surface-50, #f8fafc);
  cursor: pointer;
  user-select: none;
}

.code-review-card__header:hover {
  background: var(--p-surface-100, #f1f5f9);
}

.code-review-card__title {
  font-weight: 600;
  margin-right: 4px;
}

.code-review-card__summary {
  display: flex;
  gap: 6px;
  flex: 1;
  flex-wrap: wrap;
}

.code-review-card__chevron {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #94a3b8);
}

.badge {
  font-size: 0.72rem;
  padding: 1px 7px;
  border-radius: 10px;
  font-weight: 600;
}

.badge--rejected { background: var(--p-red-50, #fef2f2); color: var(--p-red-600, #dc2626); }
.badge--change { background: var(--p-orange-50, #fff7ed); color: var(--p-orange-600, #ea580c); }
.badge--accepted { background: var(--p-green-50, #f0fdf4); color: var(--p-green-600, #16a34a); }
.badge--comment { background: var(--p-blue-50, #eff6ff); color: var(--p-blue-600, #2563eb); }
.badge--edit { background: var(--p-purple-50, #faf5ff); color: var(--p-purple-600, #9333ea); }

.code-review-card__body {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.code-review-card__empty {
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.82rem;
  padding: 4px 0;
}

.code-review-card__file {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.code-review-card__file-name {
  font-family: monospace;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #475569);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.code-review-card__hunk {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
}

.hunk--rejected { background: var(--p-red-50, #fef2f2); }
.hunk--change_request { background: var(--p-orange-50, #fff7ed); }
.hunk--accepted { background: var(--p-green-50, #f0fdf4); }
.hunk--pending { background: var(--p-surface-100, #f1f5f9); }

.hunk-decision { font-size: 0.85rem; }
.hunk-range { font-family: monospace; font-size: 0.75rem; color: var(--p-text-muted-color, #64748b); }
.hunk-comment { font-style: italic; color: var(--p-text-color, #1e293b); flex: 1; }

/* Line comments */
.code-review-card__line-comment {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--p-blue-50, #eff6ff);
  font-size: 0.8rem;
}

.lc-icon { font-size: 0.85rem; flex-shrink: 0; }
.lc-range { font-family: monospace; font-size: 0.75rem; color: var(--p-text-muted-color, #64748b); flex-shrink: 0; }
.lc-text { font-style: italic; color: var(--p-text-color, #1e293b); flex: 1; }

/* Manual edits */
.code-review-card__section {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding-top: 8px;
  margin-top: 2px;
}

.code-review-card__section-title {
  font-weight: 600;
  font-size: 0.78rem;
  margin-bottom: 6px;
  color: var(--p-text-muted-color, #475569);
}

.code-review-card__edit-details {
  margin: 4px 0;
}

.code-review-card__edit-summary {
  cursor: pointer;
  font-family: monospace;
  font-size: 0.78rem;
  color: var(--p-primary-color, #6366f1);
  padding: 2px 0;
  user-select: none;
}

.mini-diff {
  font-family: ui-monospace, monospace;
  font-size: 0.72rem;
  white-space: pre;
  overflow-x: auto;
  margin: 4px 0 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--p-surface-100, #f1f5f9);
  color: var(--p-text-color, #1e293b);
  line-height: 1.5;
}
</style>

<style>
html.dark-mode .badge--rejected {
  background: color-mix(in srgb, var(--p-red-500) 20%, transparent);
  color: var(--p-red-300);
}
html.dark-mode .badge--change {
  background: color-mix(in srgb, var(--p-orange-500) 20%, transparent);
  color: var(--p-orange-300);
}
html.dark-mode .badge--accepted {
  background: color-mix(in srgb, var(--p-green-500) 20%, transparent);
  color: var(--p-green-300);
}
html.dark-mode .badge--comment {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}
html.dark-mode .badge--edit {
  background: color-mix(in srgb, var(--p-purple-500) 20%, transparent);
  color: var(--p-purple-300);
}
html.dark-mode .hunk--rejected {
  background: color-mix(in srgb, var(--p-red-500) 15%, transparent);
}
html.dark-mode .hunk--change_request {
  background: color-mix(in srgb, var(--p-orange-500) 15%, transparent);
}
html.dark-mode .hunk--accepted {
  background: color-mix(in srgb, var(--p-green-500) 15%, transparent);
}
html.dark-mode .code-review-card__header {
  background: var(--p-surface-800, #1e293b);
}
html.dark-mode .code-review-card__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .code-review-card__line-comment {
  background: color-mix(in srgb, var(--p-blue-500) 15%, transparent);
}
html.dark-mode .mini-diff {
  background: var(--p-surface-800, #1e293b);
}
</style>

