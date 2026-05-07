<template>
  <div class="rb">
    <button class="rb__header" @click="toggle">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'rb__chevron']" />
      <i :class="['pi', 'pi-microchip-ai', 'rb__icon', streaming && 'rb__icon--pulse']" />
      <span class="rb__label">
        <span v-if="streaming" class="rb__thinking">Reasoning…</span>
        <span v-else>Reasoned</span>
      </span>
    </button>

    <div v-if="open" ref="bodyEl" class="rb__body">
      <div class="rb__content" :class="{ 'rb__content--streaming': streaming }">{{ content }}</div>
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
// Module-level: shared across all ReasoningBubble instances in the app.
// When a streaming bubble unmounts while open (store reload after done), the
// next bubble mounted within a short window starts open instead of collapsed.
let _recentFlag = false;
let _recentTimer: ReturnType<typeof setTimeout> | null = null;

export function markRecentOpen() {
  if (_recentTimer) clearTimeout(_recentTimer);
  _recentFlag = true;
  _recentTimer = setTimeout(() => { _recentFlag = false; _recentTimer = null; }, 3000);
}

export function consumeRecentOpen(): boolean {
  if (!_recentFlag) return false;
  _recentFlag = false;
  if (_recentTimer) { clearTimeout(_recentTimer); _recentTimer = null; }
  return true;
}
</script>

<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";

const props = defineProps<{
  content: string;
  streaming: boolean;
}>();

// Start open if streaming now OR if we just finished streaming (store reload path).
const open = ref(props.streaming || consumeRecentOpen());
// Track whether this instance was ever streaming so we can mark the flag on unmount.
const wasStreaming = ref(props.streaming);

watch(() => props.streaming, (v) => { if (v) wasStreaming.value = true; });

onUnmounted(() => {
  if (wasStreaming.value && open.value) markRecentOpen();
});

function toggle() {
  open.value = !open.value;
}

const bodyEl = ref<HTMLElement | null>(null);

watch(
  () => props.content,
  () => {
    if (props.streaming && bodyEl.value) {
      bodyEl.value.scrollTop = bodyEl.value.scrollHeight;
    }
  },
);
</script>

<style scoped>
.rb {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
  opacity: 0.85;
}

.rb__header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  background: var(--p-surface-50, #f9fafb);
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: inherit;
  font-family: inherit;
  color: var(--p-text-color, #333);
}

.rb__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.rb__chevron {
  color: var(--p-text-muted-color, #888);
  font-size: 0.72rem;
}

.rb__icon {
  color: var(--p-primary-color, #6366f1);
  font-size: 0.85rem;
}

.rb__icon--pulse {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

.rb__label {
  color: var(--p-text-muted-color, #888);
}

.rb__thinking {
  font-style: italic;
}

.rb__body {
  background: var(--p-surface-0, #fff);
  border-top: 1px solid var(--p-content-border-color);
  padding: 8px 10px;
  max-height: 320px;
  overflow-y: auto;
}

.rb__content {
  white-space: pre-wrap;
  font-size: 0.78rem;
  color: var(--p-text-muted-color, #888);
  font-family: var(--p-font-family, inherit);
  line-height: 1.5;
}

.rb__content--streaming::after {
  content: "▌";
  animation: blink 1s step-end infinite;
  color: var(--p-primary-color, #6366f1);
  margin-left: 1px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
</style>

<style>
html.dark-mode .rb__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}
html.dark-mode .rb__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .rb__body {
  background: var(--p-surface-900, #0f172a);
  border-top-color: var(--p-surface-700, #334155);
}
</style>

<style>
/* Children slotted inside the reasoning bubble body */
.rb__children {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--p-content-border-color);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
