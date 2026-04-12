<template>
  <div v-if="hasAnyFiles" class="changed-files-panel">
    <!-- Header — full row is the click target for expand/collapse -->
    <div
      class="changed-files-panel__header"
      @click="expanded = !expanded"
    >
      <div class="changed-files-panel__toggle">
        <span class="changed-files-panel__toggle-icon">{{ expanded ? '▾' : '▸' }}</span>
        <span class="changed-files-panel__toggle-label">
          {{ pendingLabel }}
        </span>
      </div>
      <div class="changed-files-panel__actions" @click.stop>
      <button
        v-if="hasAllFiles"
        class="changed-files-panel__view-btn"
        type="button"
        :title="showAll ? 'Show pending only' : 'Show all changes'"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Pending' : 'All' }}
      </button>
      <!-- Review button -->
      <button
        class="changed-files-panel__review-btn"
        type="button"
        :title="showAll ? 'Open changed files' : 'Open code review'"
        @click="openReview(null)"
      >
        {{ showAll ? 'View Changes' : 'Review' }}
      </button>
      </div>
    </div>

    <!-- File list -->
    <ul v-if="expanded" class="changed-files-panel__list">
      <li
        v-for="file in displayedFiles"
        :key="file.path"
        class="changed-files-panel__item"
        :title="file.path"
        @click="openReview(file.path)"
      >
        <span class="changed-files-panel__file-icon">
          {{ file.pendingCount > 0 ? '⬜' : '✅' }}
        </span>
        <div class="changed-files-panel__file-info">
          <span class="changed-files-panel__file-name">{{ basename(file.path) }}</span>
          <span class="changed-files-panel__file-dir">{{ dirname(file.path) }}</span>
        </div>
        <span v-if="file.pendingCount > 0" class="changed-files-panel__pending-badge">
          {{ file.pendingCount }}
        </span>
        <span v-if="file.additions || file.deletions" class="changed-files-panel__stat">
          <span v-if="file.additions" class="changed-files-panel__stat--add">+{{ file.additions }}</span>
          <span v-if="file.deletions" class="changed-files-panel__stat--del">-{{ file.deletions }}</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { GitNumstat } from "@shared/rpc-types";

const props = defineProps<{
  taskId: number;
  numstat: GitNumstat | null;
  pendingByFile: { filePath: string; pendingCount: number }[];
}>();

const emit = defineEmits<{
  openReview: [filePath: string | null, mode: "review" | "changes"];
}>();

const expanded = ref(true);
const showAll = ref(false);

// Build unified file list
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
  if (!props.numstat) return pendingFiles.value;
  const pendingPaths = new Set(props.pendingByFile.map((p) => p.filePath));
  const extras = props.numstat.files
    .filter((f) => !pendingPaths.has(f.path))
    .map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      pendingCount: 0,
    }));
  return [...pendingFiles.value, ...extras];
});

const hasAnyFiles = computed(() => allFiles.value.length > 0);
const hasAllFiles = computed(() => (props.numstat?.files.length ?? 0) > pendingFiles.value.length);

const displayedFiles = computed(() => showAll.value ? allFiles.value : pendingFiles.value);

const pendingLabel = computed(() => {
  const p = pendingFiles.value.length;
  const total = allFiles.value.length;
  if (p > 0) return `${p} file${p !== 1 ? 's' : ''} awaiting review`;
  if (total > 0) return `${total} file${total !== 1 ? 's' : ''} changed`;
  return "Changed files";
});

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function openReview(filePath: string | null) {
  emit("openReview", filePath, showAll.value ? "changes" : "review");
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

.changed-files-panel__view-btn,
.changed-files-panel__review-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--p-content-border-color, currentColor);
  background: var(--p-surface-card, var(--p-surface-0, transparent));
  color: var(--p-text-color, inherit);
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.1s, border-color 0.1s;
}

.changed-files-panel__review-btn {
  background: var(--p-primary-color, #6366f1);
  border-color: var(--p-primary-color, #6366f1);
  color: #fff;
  font-weight: 600;
}

.changed-files-panel__view-btn:hover {
  background: var(--p-content-hover-background, rgba(0,0,0,0.06));
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
