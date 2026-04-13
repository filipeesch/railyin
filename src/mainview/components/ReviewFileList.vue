<template>
  <nav class="review-file-list">
    <div class="review-file-list__search">
      <input
        v-model="filterText"
        type="search"
        placeholder="Filter files…"
        class="review-file-list__search-input"
        @click.stop
      />
    </div>
    <ul class="review-file-list__items">
      <li
        v-for="file in filteredFiles"
        :key="file.path"
        class="review-file-list__item"
        :class="{ active: file.path === selectedPath }"
        :title="file.path"
        @click="emit('select', file.path)"
      >
        <span class="file-status-dot" :class="dotClass(aggregateStates?.[file.path] ?? 'pending')"></span>
        <div class="review-file-list__info">
          <span class="review-file-list__name">{{ basename(file.path) }}</span>
          <span class="review-file-list__dir">{{ dirname(file.path) }}</span>
        </div>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { HunkDecision } from "@shared/rpc-types";

const props = defineProps<{
  files: { path: string }[];
  selectedPath: string | null;
  aggregateStates?: Record<string, HunkDecision | "pending">;
}>();

const emit = defineEmits<{ select: [path: string] }>();

const filterText = ref("");

const filteredFiles = computed(() => {
  const q = filterText.value.trim().toLowerCase();
  if (!q) return props.files;
  return props.files.filter((f) => f.path.toLowerCase().includes(q));
});

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function dotClass(state: HunkDecision | "pending"): string {
  const classes: Record<string, string> = {
    pending: "file-status-dot--pending",
    accepted: "file-status-dot--accepted",
    rejected: "file-status-dot--rejected",
    change_request: "file-status-dot--cr",
  };
  return classes[state] ?? "file-status-dot--pending";
}
</script>

<style scoped>
.review-file-list {
  width: 100%;
  min-width: 150px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--p-content-background, #f8fafc);
  display: flex;
  flex-direction: column;
}

.review-file-list__search {
  padding: 8px 8px 4px;
  border-bottom: 1px solid var(--p-content-border-color, #e2e8f0);
  flex-shrink: 0;
}

.review-file-list__search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  border: 1px solid var(--p-content-border-color, #cbd5e1);
  border-radius: 4px;
  background: var(--p-surface-card, #fff);
  color: var(--p-text-color, #1e293b);
  font-size: 0.78rem;
  outline: none;
}

.review-file-list__search-input::placeholder {
  color: var(--p-text-muted-color, #94a3b8);
}

.review-file-list__search-input:focus {
  border-color: var(--p-primary-color, #6366f1);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #6366f1) 20%, transparent);
}

.review-file-list__items {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  flex: 1;
  overflow-y: auto;
}

.review-file-list__item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background 0.1s;
  min-width: 0;
}

.review-file-list__item:hover {
  background: var(--p-content-hover-background, #f1f5f9);
}

.review-file-list__item.active {
  background: var(--p-highlight-background, #eef2ff);
  font-weight: 500;
}

.file-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.file-status-dot--pending {
  border: 1.5px solid var(--p-text-muted-color, #94a3b8);
  background: transparent;
}
.file-status-dot--accepted {
  background: var(--p-green-400, #4ade80);
}
.file-status-dot--rejected {
  background: var(--p-red-400, #f87171);
}
.file-status-dot--cr {
  background: var(--p-amber-400, #fbbf24);
}

.review-file-list__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.review-file-list__name {
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-file-list__dir {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

/* Dark mode overrides */
.dark .review-file-list,
[data-theme="dark"] .review-file-list {
  background: var(--p-surface-card, #1e293b);
}

.dark .review-file-list__search-input,
[data-theme="dark"] .review-file-list__search-input {
  background: var(--p-surface-ground, #0f172a);
  color: var(--p-text-color, #f1f5f9);
  border-color: var(--p-surface-border, #334155);
}
</style>
