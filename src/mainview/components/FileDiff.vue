<template>
  <!-- Rename: no expand, just from→to label -->
  <div v-if="payload.operation === 'rename_file'" class="fdiff fdiff--simple">
    <i class="pi pi-arrow-right-arrow-left fdiff__icon" />
    <span class="fdiff__path">{{ payload.path }}</span>
    <span class="fdiff__arrow"> → </span>
    <span class="fdiff__path">{{ payload.to_path }}</span>
    <span class="fdiff__tag fdiff__tag--info">renamed</span>
  </div>

  <!-- write_file / patch_file / delete_file: scrollable hunk viewer -->
  <div v-else class="fdiff">
    <div v-if="(payload.hunks?.length ?? 0) > 0" class="fdiff__body" ref="bodyRef">
      <!-- Load More ↑ -->
      <button v-if="hasMore.up" class="fdiff__load-more" @click="loadMoreUp">
        <i class="pi pi-chevron-up" />
        Load more &nbsp;·&nbsp; {{ windowStart }} lines above
      </button>

      <!-- Hunk groups -->
      <template v-for="grp in visibleGroups" :key="grp.hunkIdx">
        <div class="fdiff__hunk-header">
          @@ -{{ grp.oldStart }} +{{ grp.newStart }} @@
        </div>
        <div
          v-for="(item, i) in grp.items"
          :key="i"
          :class="['fdiff__line', `fdiff__line--${item.line.type}`]"
        >
          <span class="fdiff__gutter fdiff__gutter--old">{{ item.line.old_line ?? '' }}</span>
          <span class="fdiff__gutter fdiff__gutter--new">{{ item.line.new_line ?? '' }}</span>
          <span class="fdiff__sign">{{ item.line.type === 'added' ? '+' : item.line.type === 'removed' ? '-' : ' ' }}</span>
          <span class="fdiff__content">{{ item.line.content }}</span>
        </div>
      </template>

      <!-- Load More ↓ -->
      <button v-if="hasMore.down" class="fdiff__load-more" @click="loadMoreDown">
        <i class="pi pi-chevron-down" />
        Load more &nbsp;·&nbsp; {{ totalLines - windowEnd - 1 }} lines below
      </button>
    </div>
    <div v-else class="fdiff__empty">no diff available</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import type { FileDiffPayload, HunkLine, Hunk } from "@shared/rpc-types";

const props = defineProps<{
  payload: FileDiffPayload;
}>();

const CAP   = 50;
const CHUNK = 25;

// ── Flat line list ────────────────────────────────────────────────────────────

interface FlatItem {
  hunkIdx: number;
  hunk: Hunk;
  line: HunkLine;
}

const flatItems = computed<FlatItem[]>(() =>
  (props.payload.hunks ?? []).flatMap((hunk, hi) =>
    hunk.lines.map((line) => ({ hunkIdx: hi, hunk, line }))
  )
);

const totalLines = computed(() => flatItems.value.length);

// ── Bidirectional window ──────────────────────────────────────────────────────

const windowStart = ref(0);
const windowEnd   = ref(0);

watch(
  () => props.payload,
  () => {
    windowStart.value = 0;
    windowEnd.value   = Math.min(CAP - 1, flatItems.value.length - 1);
  },
  { immediate: true },
);

const hasMore = computed(() => ({
  up:   windowStart.value > 0,
  down: windowEnd.value < totalLines.value - 1,
}));

// ── Grouped view (consecutive items in same hunk share a @@ header) ───────────

interface VisGroup {
  hunkIdx: number;
  hunk:    Hunk;
  oldStart: number;
  newStart: number;
  items:   FlatItem[];
}

const visibleGroups = computed<VisGroup[]>(() => {
  const slice  = flatItems.value.slice(windowStart.value, windowEnd.value + 1);
  const groups: VisGroup[] = [];
  for (const item of slice) {
    const last = groups[groups.length - 1];
    if (last && last.hunkIdx === item.hunkIdx) {
      last.items.push(item);
    } else {
      // Use actual first visible line number, not the hunk's nominal start
      const oldStart = item.line.old_line ?? item.hunk.old_start;
      const newStart = item.line.new_line ?? item.hunk.new_start;
      groups.push({ hunkIdx: item.hunkIdx, hunk: item.hunk, oldStart, newStart, items: [item] });
    }
  }
  return groups;
});

// ── Load more actions ─────────────────────────────────────────────────────────

const bodyRef = ref<HTMLElement | null>(null);

function loadMoreUp() {
  windowStart.value = Math.max(0, windowStart.value - CHUNK);
  nextTick(() => { if (bodyRef.value) bodyRef.value.scrollTop = 0; });
}

function loadMoreDown() {
  windowEnd.value = Math.min(totalLines.value - 1, windowEnd.value + CHUNK);
}
</script>

<style scoped>
.fdiff {
  font-size: 0.8rem;
  overflow: hidden;
}

.fdiff--simple {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--p-surface-50, #fafafa);
}

.fdiff__body {
  max-height: 280px;
  overflow-y: auto;
}

.fdiff__empty {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}

.fdiff__load-more {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 4px 10px;
  font-size: 0.71rem;
  font-family: inherit;
  color: #0969da;
  background: #f0f6ff;
  border: none;
  border-bottom: 1px solid var(--p-surface-200, #e8e8e8);
  cursor: pointer;
  text-align: left;
}

.fdiff__load-more:last-child {
  border-bottom: none;
  border-top: 1px solid var(--p-surface-200, #e8e8e8);
}

.fdiff__load-more:hover {
  background: #dbeafe;
}

.fdiff__path {
  color: var(--p-text-color, #333);
  font-family: monospace;
  font-size: 0.78rem;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fdiff__arrow {
  color: var(--p-text-muted-color, #888);
}

.fdiff__tag {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  flex-shrink: 0;
}

.fdiff__tag--added {
  background: #d4f4dd;
  color: #1a7f37;
}

.fdiff__tag--removed {
  background: #fde7e7;
  color: #c0392b;
}

.fdiff__tag--info {
  background: #e0f0ff;
  color: #0969da;
}

.fdiff__hunk-header {
  background: #f0f6ff;
  color: #0969da;
  font-family: monospace;
  font-size: 0.72rem;
  padding: 2px 8px;
  position: sticky;
  top: 0;
  z-index: 1;
}

.fdiff__line {
  display: flex;
  font-family: monospace;
  font-size: 0.75rem;
  line-height: 1.4;
}

.fdiff__line--added   { background: #e6ffed; }
.fdiff__line--removed { background: #ffeef0; }
.fdiff__line--context { background: transparent; }

.fdiff__gutter {
  width: 3ch;
  text-align: right;
  padding: 0 4px;
  color: var(--p-text-muted-color, #888);
  user-select: none;
  flex-shrink: 0;
}

.fdiff__sign {
  width: 1.5ch;
  text-align: center;
  flex-shrink: 0;
  color: inherit;
}

.fdiff__line--added   .fdiff__sign { color: #1a7f37; }
.fdiff__line--removed .fdiff__sign { color: #c0392b; }

.fdiff__content {
  flex: 1;
  padding: 0 4px;
  white-space: pre;
  overflow-x: auto;
}
</style>

<style>
html.dark-mode .fdiff__load-more {
  background: #0f172a;
  color: #60a5fa;
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .fdiff__load-more:hover {
  background: #1e293b;
}
html.dark-mode .fdiff__hunk-header {
  background: #1e2d45;
  color: #60a5fa;
}
html.dark-mode .fdiff__line--added   { background: #0d2b1a; }
html.dark-mode .fdiff__line--removed { background: #2b0d0d; }
html.dark-mode .fdiff__line--added   .fdiff__sign { color: #4ade80; }
html.dark-mode .fdiff__line--removed .fdiff__sign { color: #f87171; }
html.dark-mode .fdiff__tag--added {
  background: #14532d;
  color: #86efac;
}
html.dark-mode .fdiff__tag--removed {
  background: #450a0a;
  color: #fca5a5;
}
html.dark-mode .fdiff__tag--info {
  background: #1e2d45;
  color: #60a5fa;
}
</style>
