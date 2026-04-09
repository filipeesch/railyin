<template>
  <div class="code-review-card">
    <div class="code-review-card__header" @click="expanded = !expanded">
      <span class="code-review-card__icon">🔍</span>
      <span class="code-review-card__title">Code Review submitted</span>
      <div class="code-review-card__summary">
        <span v-if="stats.rejected > 0" class="badge badge--rejected">❌ {{ stats.rejected }} rejected</span>
        <span v-if="stats.change_request > 0" class="badge badge--change">📝 {{ stats.change_request }} change requested</span>
        <span v-if="stats.accepted > 0" class="badge badge--accepted">✅ {{ stats.accepted }} accepted</span>
        <span v-if="stats.pending > 0" class="badge badge--pending">⬜ {{ stats.pending }} pending</span>
      </div>
      <span class="code-review-card__chevron">{{ expanded ? "▲" : "▼" }}</span>
    </div>

    <div v-if="expanded" class="code-review-card__body">
      <div
        v-for="file in payload.files"
        :key="file.path"
        class="code-review-card__file"
      >
        <div class="code-review-card__file-name">{{ file.path }}</div>
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

const stats = computed(() => {
  const counts = { accepted: 0, rejected: 0, change_request: 0, pending: 0 };
  for (const file of payload.value.files) {
    for (const hunk of file.hunks) {
      counts[hunk.decision] = (counts[hunk.decision] ?? 0) + 1;
    }
  }
  return counts;
});

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
.badge--pending { background: var(--p-surface-100, #f1f5f9); color: var(--p-text-muted-color, #64748b); }

.code-review-card__body {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.code-review-card__file-name {
  font-family: monospace;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #475569);
  margin-bottom: 4px;
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
html.dark-mode .hunk--rejected {
  background: color-mix(in srgb, var(--p-red-500) 15%, transparent);
}
html.dark-mode .hunk--change_request {
  background: color-mix(in srgb, var(--p-orange-500) 15%, transparent);
}
html.dark-mode .hunk--accepted {
  background: color-mix(in srgb, var(--p-green-500) 15%, transparent);
}
</style>
