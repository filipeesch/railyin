<template>
  <div v-if="hasAnyFiles" class="changed-files-panel">
    <!-- ── State A: pending hunks exist ─────────────────────────────────── -->
    <template v-if="hasPendingHunks">
      <!-- Header -->
      <div class="changed-files-panel__header" @click="expanded = !expanded">
        <div class="changed-files-panel__toggle">
          <span class="changed-files-panel__toggle-icon">{{ expanded ? '▾' : '▸' }}</span>
          <span class="changed-files-panel__toggle-label">{{ pendingLabel }}</span>
        </div>
        <div class="changed-files-panel__actions" @click.stop>
          <button
            class="changed-files-panel__ghost-btn"
            type="button"
            title="Accept all pending hunks"
            :disabled="deciding"
            @click="decideAll('accepted')"
          >Accept All</button>
          <button
            class="changed-files-panel__ghost-btn"
            type="button"
            title="Reject all pending hunks"
            :disabled="deciding"
            @click="decideAll('rejected')"
          >Reject All</button>
          <button
            class="changed-files-panel__review-btn"
            type="button"
            title="Open code review"
            @click="openReview(null, 'review')"
          >Review</button>
        </div>
      </div>

      <!-- File list -->
      <ul v-if="expanded" class="changed-files-panel__list">
        <li
          v-for="file in pendingFiles"
          :key="file.path"
          class="changed-files-panel__item"
          :title="file.path"
          @click="openReview(file.path, 'review')"
        >
          <span class="changed-files-panel__file-icon">⬜</span>
          <div class="changed-files-panel__file-info">
            <span class="changed-files-panel__file-name">{{ basename(file.path) }}</span>
            <span class="changed-files-panel__file-dir">{{ dirname(file.path) }}</span>
          </div>
          <span class="changed-files-panel__pending-badge">{{ file.pendingCount }}</span>
          <span v-if="file.additions || file.deletions" class="changed-files-panel__stat">
            <span v-if="file.additions" class="changed-files-panel__stat--add">+{{ file.additions }}</span>
            <span v-if="file.deletions" class="changed-files-panel__stat--del">-{{ file.deletions }}</span>
          </span>
        </li>
      </ul>
    </template>

    <!-- ── State B: all decided — expandable file list ───────────────────── -->
    <template v-else>
      <div class="changed-files-panel__header" @click="expanded = !expanded">
        <div class="changed-files-panel__toggle">
          <span class="changed-files-panel__toggle-icon changed-files-panel__toggle-icon--done">✓</span>
          <span class="changed-files-panel__toggle-label">{{ allReviewedLabel }}</span>
        </div>
        <div class="changed-files-panel__actions" @click.stop>
          <button
            class="changed-files-panel__ghost-btn"
            type="button"
            title="View all changes"
            @click="openReview(null, 'changes')"
          >View Changes</button>
        </div>
      </div>

      <ul v-if="expanded" class="changed-files-panel__list">
        <li
          v-for="file in allFiles"
          :key="file.path"
          class="changed-files-panel__item"
          :title="file.path"
          @click="openReview(file.path, 'changes')"
        >
          <span class="changed-files-panel__file-icon changed-files-panel__file-icon--done">✓</span>
          <div class="changed-files-panel__file-info">
            <span class="changed-files-panel__file-name">{{ basename(file.path) }}</span>
            <span class="changed-files-panel__file-dir">{{ dirname(file.path) }}</span>
          </div>
          <span v-if="file.additions || file.deletions" class="changed-files-panel__stat">
            <span v-if="file.additions" class="changed-files-panel__stat--add">+{{ file.additions }}</span>
            <span v-if="file.deletions" class="changed-files-panel__stat--del">-{{ file.deletions }}</span>
          </span>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { GitNumstat } from "@shared/rpc-types";
import { api } from "../rpc";

const props = defineProps<{
  taskId: number;
  numstat: GitNumstat | null;
  pendingByFile: { filePath: string; pendingCount: number }[];
}>();

const emit = defineEmits<{
  openReview: [filePath: string | null, mode: "review" | "changes"];
}>();

const expanded = ref(false);
const deciding = ref(false);

interface FileEntry {
  path: string;
  additions: number;
  deletions: number;
  pendingCount: number;
}

const pendingFiles = computed<FileEntry[]>(() => {
  return props.pendingByFile
    .filter((p) => p.pendingCount > 0)
    .map((p) => {
      const ns = props.numstat?.files.find((f) => f.path === p.filePath);
      return {
        path: p.filePath,
        additions: ns?.additions ?? 0,
        deletions: ns?.deletions ?? 0,
        pendingCount: p.pendingCount,
      };
    });
});

const allFiles = computed<FileEntry[]>(() => {
  const fromReview = props.pendingByFile.map((p) => {
    const ns = props.numstat?.files.find((f) => f.path === p.filePath);
    return {
      path: p.filePath,
      additions: ns?.additions ?? 0,
      deletions: ns?.deletions ?? 0,
      pendingCount: p.pendingCount,
    };
  });
  if (!props.numstat) return fromReview;
  const knownPaths = new Set(props.pendingByFile.map((p) => p.filePath));
  const extras = props.numstat.files
    .filter((f) => !knownPaths.has(f.path))
    .map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      pendingCount: 0,
    }));
  return [...fromReview, ...extras];
});

const hasAnyFiles = computed(() => allFiles.value.length > 0);
const hasPendingHunks = computed(() => pendingFiles.value.length > 0);

const pendingLabel = computed(() => {
  const p = pendingFiles.value.length;
  return `${p} file${p !== 1 ? 's' : ''} awaiting review`;
});

const allReviewedLabel = computed(() => {
  const total = allFiles.value.length;
  return `${total} file${total !== 1 ? 's' : ''} changed · all reviewed`;
});

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function openReview(filePath: string | null, mode: "review" | "changes") {
  emit("openReview", filePath, mode);
}

async function decideAll(decision: "accepted" | "rejected") {
  if (deciding.value) return;
  deciding.value = true;
  try {
    await api("tasks.decideAllHunks", { taskId: props.taskId, decision });
  } finally {
    deciding.value = false;
  }
}
</script>

<style scoped>
.changed-files-panel {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  margin: 0 0 8px 0;
  overflow: hidden;
  flex-shrink: 0;
}

/* ── Header toggle ─────────────────────────────────────────────────────── */

.changed-files-panel__header {
  display: flex;
  align-items: stretch;
  cursor: pointer;
  user-select: none;
}

/* State B header is also clickable (expandable file list) */

.changed-files-panel__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  padding: 7px 10px;
  color: var(--p-text-color, inherit);
  font-size: 0.78rem;
  font-weight: 500;
}

.changed-files-panel__header:hover {
  background: var(--p-content-hover-background, rgba(0,0,0,0.04));
}

.changed-files-panel__toggle-icon {
  font-size: 0.65rem;
  opacity: 0.6;
  flex-shrink: 0;
}

.changed-files-panel__toggle-icon--done {
  font-size: 0.75rem;
  opacity: 0.8;
  color: var(--p-green-500, #22c55e);
}

.changed-files-panel__toggle-label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Action buttons in header ──────────────────────────────────────────── */

.changed-files-panel__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px 7px 0;
}

.changed-files-panel__ghost-btn,
.changed-files-panel__review-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--p-content-border-color);
  background: transparent;
  color: var(--p-text-color, inherit);
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.1s, border-color 0.1s;
}

.changed-files-panel__ghost-btn:hover:not(:disabled) {
  background: var(--p-content-hover-background, rgba(0,0,0,0.06));
}

.changed-files-panel__ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.changed-files-panel__review-btn {
  background: var(--p-primary-color, #6366f1);
  border-color: var(--p-primary-color, #6366f1);
  color: #fff;
  font-weight: 600;
}

.changed-files-panel__review-btn:hover {
  filter: brightness(1.1);
}

/* ── File list ─────────────────────────────────────────────────────────── */

.changed-files-panel__list {
  list-style: none;
  margin: 0;
  padding: 2px 0 4px;
  border-top: 1px solid var(--p-content-border-color, #e2e8f0);
  max-height: 200px;
  overflow-y: auto;
}

.changed-files-panel__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  column-gap: 8px;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: 4px;
  margin: 1px 4px;
  transition: background 0.1s;
}

.changed-files-panel__item:hover {
  background: var(--p-content-hover-background, rgba(0,0,0,0.04));
}

.changed-files-panel__file-icon {
  font-size: 0.8rem;
  flex-shrink: 0;
}

.changed-files-panel__file-icon--done {
  font-size: 0.75rem;
  color: var(--p-green-500, #22c55e);
  opacity: 0.8;
}

.changed-files-panel__file-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.changed-files-panel__file-name {
  font-size: 0.78rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.changed-files-panel__file-dir {
  font-size: 0.68rem;
  color: var(--p-text-muted-color, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

/* ── Stats & badge ────────────────────────────────────────────────────── */

.changed-files-panel__pending-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--p-primary-color, #6366f1);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
  justify-self: end;
}

.changed-files-panel__stat {
  display: flex;
  justify-content: flex-end;
  gap: 3px;
  font-size: 0.68rem;
  flex-shrink: 0;
  min-width: 52px;
  justify-self: end;
}

.changed-files-panel__stat--add {
  color: var(--p-green-500, #22c55e);
}

.changed-files-panel__stat--del {
  color: var(--p-red-500, #ef4444);
}
</style>
