<template>
  <div :class="['sa', { 'sa--done': done, 'sa--error': isError }]">
    <!-- Header: status icon + intent -->
    <button class="sa__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'sa__chevron']" />
      <span v-if="!done" class="sa__spinner">
        <i class="pi pi-spin pi-spinner sa__status-icon sa__status-icon--running" />
      </span>
      <i v-else-if="isError" class="pi pi-times-circle sa__status-icon sa__status-icon--error" />
      <i v-else class="pi pi-check-circle sa__status-icon sa__status-icon--done" />
      <span class="sa__intent">{{ intent }}</span>
    </button>

    <div v-if="open" class="sa__body">
      <!-- Prompt shown collapsed by default -->
      <details class="sa__prompt-details">
        <summary class="sa__prompt-summary">Prompt</summary>
        <div class="sa__prompt prose" v-html="renderMd(prompt)" />
      </details>

      <!-- Live stream children (tool calls from this subagent) -->
      <div v-if="childBlockIds && childBlockIds.length > 0 && blocks" class="sa__children">
        <StreamBlockNode
          v-for="childId in childBlockIds"
          :key="childId"
          :blockId="childId"
          :blocks="blocks"
          :renderMd="renderMd"
        />
      </div>

      <!-- History children (persisted ToolEntry children) -->
      <div v-else-if="childEntries && childEntries.length > 0" class="sa__children">
        <ToolCallGroup
          v-for="child in childEntries"
          :key="String(child.call.id)"
          :entry="child"
        />
      </div>

      <!-- Result summary shown when done -->
      <div v-if="done && result" class="sa__result prose" v-html="renderMd(result)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { StreamBlock } from "../stores/conversation";
import type { ToolEntry } from "../utils/pairToolMessages";
import StreamBlockNode from "./StreamBlockNode.vue";
import ToolCallGroup from "./ToolCallGroup.vue";

defineProps<{
  intent: string;
  prompt: string;
  done: boolean;
  isError?: boolean;
  result?: string;
  renderMd: (md: string) => string;
  // Live stream
  childBlockIds?: string[];
  blocks?: Map<string, StreamBlock>;
  // History
  childEntries?: ToolEntry[];
}>();

const open = ref(false);
</script>

<style scoped>
.sa {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
  background: var(--p-surface-0, #fff);
}

.sa__header {
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

.sa__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.sa__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.sa__spinner {
  display: flex;
  align-items: center;
}

.sa__status-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.sa__status-icon--running {
  color: var(--p-primary-color, #6366f1);
}

.sa__status-icon--done {
  color: #16a34a;
}

.sa__status-icon--error {
  color: #dc2626;
}

.sa__intent {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--p-text-color, #1e293b);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sa__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sa__prompt-details {
  font-size: 0.75rem;
}

.sa__prompt-summary {
  cursor: pointer;
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.72rem;
  user-select: none;
}

.sa__prompt-summary:hover {
  color: var(--p-text-color, #333);
}

.sa__prompt {
  margin-top: 6px;
  padding: 8px;
  background: var(--p-surface-50, #f9fafb);
  border-radius: 4px;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  font-size: 0.75rem;
  max-height: 300px;
  overflow-y: auto;
}

.sa__children {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sa__result {
  padding: 6px 8px;
  background: color-mix(in srgb, #16a34a 8%, transparent);
  border-radius: 4px;
  font-size: 0.75rem;
  border-left: 3px solid #16a34a;
}
</style>

<style>
html.dark-mode .sa {
  border-color: var(--p-surface-700, #334155);
  background: var(--p-surface-900, #0f172a);
}

html.dark-mode .sa__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}

html.dark-mode .sa__header:hover {
  background: var(--p-surface-700, #334155);
}

html.dark-mode .sa__body {
  border-top-color: var(--p-surface-700, #334155);
}

html.dark-mode .sa__prompt {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-700, #334155);
}

html.dark-mode .sa__result {
  background: color-mix(in srgb, #16a34a 15%, transparent);
}
</style>
