<template>
  <nav class="review-file-list">
    <div class="review-file-list__header">Files ({{ files.length }})</div>
    <ul class="review-file-list__items">
      <li
        v-for="file in files"
        :key="file.path"
        class="review-file-list__item"
        :class="{ active: file.path === selectedPath }"
        @click="emit('select', file.path)"
      >
        <span class="review-file-list__icon">{{ stateIcon(aggregateStates?.[file.path] ?? 'pending') }}</span>
        <span class="review-file-list__name" :title="file.path">{{ basename(file.path) }}</span>
        <span class="review-file-list__dir">{{ dirname(file.path) }}</span>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import type { HunkDecision } from "@shared/rpc-types";

defineProps<{
  files: { path: string }[];
  selectedPath: string | null;
  aggregateStates?: Record<string, HunkDecision | "pending">;
}>();

const emit = defineEmits<{ select: [path: string] }>();

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function stateIcon(state: HunkDecision | "pending"): string {
  const icons: Record<string, string> = {
    pending: "⬜",
    accepted: "✅",
    rejected: "❌",
    change_request: "📝",
  };
  return icons[state] ?? "⬜";
}
</script>

<style scoped>
.review-file-list {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--p-content-border-color, #e2e8f0);
  overflow-y: auto;
  background: var(--p-content-background, #f8fafc);
  display: flex;
  flex-direction: column;
}

.review-file-list__header {
  padding: 10px 12px 6px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color, #64748b);
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
}

.review-file-list__items {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.review-file-list__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background 0.1s;
}

.review-file-list__item:hover {
  background: var(--p-content-hover-background, #f1f5f9);
}

.review-file-list__item.active {
  background: var(--p-highlight-background, #eef2ff);
  font-weight: 500;
}

.review-file-list__icon {
  font-size: 0.85rem;
  flex-shrink: 0;
}

.review-file-list__name {
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.review-file-list__dir {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
  text-align: right;
}
</style>
