<template>
  <div class="rb">
    <button class="rb__header" @click="toggle">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'rb__chevron']" />
      <i :class="['pi', 'pi-microchip-ai', 'rb__icon', streaming && 'rb__icon--pulse']" />
      <span class="rb__label">
        <span v-if="streaming" class="rb__thinking">Thinking…</span>
        <span v-else>Reasoned</span>
      </span>
    </button>

    <div v-if="open" class="rb__body">
      <div class="rb__content" :class="{ 'rb__content--streaming': streaming }">{{ content }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  content: string;
  streaming: boolean;
}>();

// Auto-expand while streaming, auto-collapse when streaming ends
const open = ref(props.streaming);

watch(
  () => props.streaming,
  (active) => {
    if (active) open.value = true;
    else open.value = false;
  },
);

function toggle() {
  open.value = !open.value;
}
</script>

<style scoped>
.rb {
  border: 1px solid var(--p-surface-200, #e2e8f0);
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
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
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
