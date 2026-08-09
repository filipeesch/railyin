<template>
  <div :class="['ds', { 'ds--done': done, 'ds--error': isError }]" :data-testid="testId">
    <button class="ds__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'ds__chevron']" />
      <i :class="['pi', statusIcon.icon, 'ds__status-icon']" :style="statusIcon.style" />
      <span class="ds__intent">{{ intent }}</span>
      <span v-if="children.length > 0" class="ds__badge">
        <i class="pi pi-sitemap ds__badge-icon" />
        {{ children.length }}
      </span>
    </button>

    <div v-if="open" class="ds__body">
      <details v-if="prompt" class="ds__prompt-details">
        <summary class="ds__prompt-summary">Prompt</summary>
        <div class="ds__prompt prose" v-html="renderMd(prompt)" />
      </details>

      <div v-if="children.length > 0" class="ds__children">
        <div v-for="(child, i) in children" :key="i" class="ds__child">
          <i class="pi pi-angle-right ds__child-icon" />
          <code class="ds__child-name">{{ child.name ?? "tool" }}</code>
          <span v-if="child.intent" class="ds__child-intent">{{ child.intent }}</span>
        </div>
      </div>

      <div v-if="done && result" class="ds__result prose" v-html="renderMd(result)" />
      <div v-else-if="isPending" class="ds__empty">Running…</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { CopilotChatToolCallRenderSlotProps } from "@copilotkit/vue/v2";
import { useMarkdown } from "../../../composables/useMarkdown";
import { toolStatusToIcon, isErrorResult } from "../../../utils/toolCardDisplay";

/**
 * DelegateSummaryRenderer — port of the legacy SubagentBlock (SubagentBlock.vue)
 * for the subagent family: collapsible header with intent + status icon,
 * "Prompt" details, result markdown, and nested child tool calls collapsing
 * inside with a count badge. Markdown runs through the legacy useMarkdown
 * (marked) pipeline — same profile as the existing SubagentBlock (T-05-02).
 */
const props = defineProps<{
  name: string;
  args?: CopilotChatToolCallRenderSlotProps["args"];
  status?: CopilotChatToolCallRenderSlotProps["status"];
  result?: CopilotChatToolCallRenderSlotProps["result"];
  toolCall?: CopilotChatToolCallRenderSlotProps["toolCall"] | null;
}>();

const testId = computed(() => (props.toolCall ? `tool-card-${props.toolCall.id}` : undefined));

const { renderMd } = useMarkdown();

const open = ref(false);

const done = computed(() => props.status === "complete");
const isPending = computed(() => !done.value);
const isError = computed(() => isErrorResult(props.result));
const statusIcon = computed(() => toolStatusToIcon(props.status ?? "inProgress", isError.value));

const intent = computed(() => extractString(props.args, ["intent", "task", "title"]) ?? "delegate");
const prompt = computed(() => extractString(props.args, ["prompt", "instructions"]) ?? "");
const children = computed(() => extractChildren(props.args));

/** First string field matching one of the candidate keys. */
function extractString(args: unknown, keys: string[]): string | undefined {
  const a = normalizeArgs(args);
  for (const key of keys) {
    const v = a[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** Nested child tool calls carried in the args (the wire's ToolMessage is flat). */
function extractChildren(args: unknown): Array<{ name?: string; intent?: string }> {
  const a = normalizeArgs(args);
  if (!Array.isArray(a.children)) return [];
  return (a.children as unknown[]).filter((c) => typeof c === "object" && c !== null) as Array<{
    name?: string;
    intent?: string;
  }>;
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}
</script>

<style scoped>
.ds {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
  background: var(--p-surface-0, #fff);
}

.ds__header {
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

.ds__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.ds__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.ds__status-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.ds__intent {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--p-text-color, #1e293b);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ds__badge {
  display: flex;
  align-items: center;
  gap: 3px;
  background: var(--p-blue-100, #e0f2fe);
  color: var(--p-blue-700, #0369a1);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.67rem;
  font-weight: 600;
  flex-shrink: 0;
}

.ds__badge-icon {
  font-size: 0.6rem;
}

.ds__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ds__prompt-details {
  font-size: 0.75rem;
}

.ds__prompt-summary {
  cursor: pointer;
  color: var(--p-text-muted-color, #64748b);
  font-size: 0.72rem;
  user-select: none;
}

.ds__prompt-summary:hover {
  color: var(--p-text-color, #333);
}

.ds__prompt {
  margin-top: 6px;
  padding: 8px;
  background: var(--p-surface-50, #f9fafb);
  border-radius: 4px;
  border: 1px solid var(--p-surface-200, #e2e8f0);
  font-size: 0.75rem;
  max-height: 300px;
  overflow-y: auto;
}

.ds__children {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 10px;
  border-left: 2px solid var(--p-surface-200, #e2e8f0);
}

.ds__child {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.72rem;
}

.ds__child-icon {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.6rem;
}

.ds__child-name {
  font-family: monospace;
  color: var(--p-primary-color, #6366f1);
  font-size: 0.7rem;
}

.ds__child-intent {
  color: var(--p-text-muted-color, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds__result {
  padding: 6px 8px;
  background: color-mix(in srgb, #16a34a 8%, transparent);
  border-radius: 4px;
  font-size: 0.75rem;
  border-left: 3px solid #16a34a;
}

.ds__empty {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}
</style>

<style>
html.dark-mode .ds {
  border-color: var(--p-surface-700, #334155);
  background: var(--p-surface-900, #0f172a);
}

html.dark-mode .ds__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}

html.dark-mode .ds__header:hover {
  background: var(--p-surface-700, #334155);
}

html.dark-mode .ds__body {
  border-top-color: var(--p-surface-700, #334155);
}

html.dark-mode .ds__prompt {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-700, #334155);
}

html.dark-mode .ds__children {
  border-left-color: var(--p-surface-700, #334155);
}

html.dark-mode .ds__badge {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}

html.dark-mode .ds__result {
  background: color-mix(in srgb, #16a34a 15%, transparent);
}
</style>
