<template>
  <div class="rv__body" ref="bodyRef">
    <!-- Load More ↑ -->
    <button v-if="windowStart > 0" class="rv__load-more rv__load-more--top" @click="loadMoreUp">
      <i class="pi pi-chevron-up" />
      Load more &nbsp;·&nbsp; {{ windowStart }} lines above
    </button>

    <!-- Lines -->
    <div
      v-for="(line, i) in visibleLines"
      :key="windowStart + i"
      class="rv__line"
    >
      <span class="rv__gutter">{{ windowStart + i + 1 }}</span>
      <span class="rv__content">{{ line }}</span>
    </div>

    <!-- Load More ↓ -->
    <button v-if="windowEnd < lines.length - 1" class="rv__load-more rv__load-more--bottom" @click="loadMoreDown">
      <i class="pi pi-chevron-down" />
      Load more &nbsp;·&nbsp; {{ lines.length - 1 - windowEnd }} lines below
    </button>

    <div v-if="lines.length === 0" class="rv__empty">(empty)</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";

const props = defineProps<{ content: string }>();

const CAP   = 50;
const CHUNK = 25;

const lines = computed(() => {
  if (!props.content) return [];
  const ls = props.content.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
});

const windowStart = ref(0);
const windowEnd   = ref(0);

watch(
  () => props.content,
  () => {
    windowStart.value = 0;
    windowEnd.value   = Math.min(CAP - 1, lines.value.length - 1);
  },
  { immediate: true },
);

const visibleLines = computed(() =>
  lines.value.slice(windowStart.value, windowEnd.value + 1)
);

const bodyRef = ref<HTMLElement | null>(null);

function loadMoreUp() {
  windowStart.value = Math.max(0, windowStart.value - CHUNK);
  nextTick(() => { if (bodyRef.value) bodyRef.value.scrollTop = 0; });
}

function loadMoreDown() {
  windowEnd.value = Math.min(lines.value.length - 1, windowEnd.value + CHUNK);
}
</script>

<style scoped>
.rv__body {
  max-height: 280px;
  overflow-y: auto;
  font-size: 0.75rem;
  font-family: monospace;
}

.rv__line {
  display: flex;
  line-height: 1.4;
  background: transparent;
}

.rv__gutter {
  width: 4ch;
  text-align: right;
  padding: 0 6px 0 4px;
  color: var(--p-text-muted-color, #94a3b8);
  user-select: none;
  flex-shrink: 0;
  border-right: 1px solid var(--p-surface-200, #e8e8e8);
  margin-right: 6px;
}

.rv__content {
  flex: 1;
  white-space: pre;
  overflow-x: auto;
  color: var(--p-text-color, #1e293b);
  padding: 0 4px;
}

.rv__load-more {
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
  cursor: pointer;
  text-align: left;
}

.rv__load-more--top {
  border-bottom: 1px solid var(--p-surface-200, #e8e8e8);
  position: sticky;
  top: 0;
  z-index: 1;
}

.rv__load-more--bottom {
  border-top: 1px solid var(--p-surface-200, #e8e8e8);
}

.rv__load-more:hover {
  background: #dbeafe;
}

.rv__empty {
  padding: 6px 10px;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
  font-size: 0.72rem;
}
</style>
