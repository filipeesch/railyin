<template>
  <div class="tcg">
    <button class="tcg__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'tcg__chevron']" />
      <i :class="['pi', statusIcon, 'tcg__tool-icon']" :style="statusIconStyle" />
      <code class="tcg__tool-name">{{ display?.label }}</code>
      <span v-if="primaryArg" class="tcg__primary-arg" :title="fullSubject">{{ primaryArg }}</span>
      <span v-if="hasChildren" class="tcg__badge">
        <i class="pi pi-sitemap tcg__badge-icon" />
        {{ entry.children.length }}
      </span>
      <span v-if="totalAdded > 0" class="tcg__stat tcg__stat--added">+{{ totalAdded }}</span>
      <span v-if="totalRemoved > 0" class="tcg__stat tcg__stat--removed">-{{ totalRemoved }}</span>
    </button>

    <div v-if="open" :class="['tcg__body', (effectiveDiffPayloads.length > 0 || display?.contentType === 'file') ? 'tcg__body--flush' : '']">
      <template v-if="effectiveDiffPayloads.length > 0">
        <FileDiff
          v-for="(payload, idx) in effectiveDiffPayloads"
          :key="`${payload.path}-${payload.to_path ?? ''}-${idx}`"
          :payload="payload"
        />
      </template>
      <ReadView v-else-if="display?.contentType === 'file'" :content="displayContent" :startLine="readFileStartLine" />
      <div v-else-if="entry.result && displayBlocks.length > 0" class="tcg__blocks">
        <section v-for="block in displayBlocks" :key="block.key" class="tcg__block">
          <div class="tcg__block-label">{{ block.label }}</div>
          <pre class="tcg__output tcg__output--block">{{ block.content }}</pre>
        </section>
      </div>
      <pre v-else-if="entry.result && hasOutput" class="tcg__output">{{ truncated }}</pre>
      <div v-else-if="entry.result && !hasChildren" class="tcg__empty">No output produced.</div>

      <div v-if="hasChildren" class="tcg__children">
        <ToolCallGroup
          v-for="child in entry.children"
          :key="child.call.id"
          :entry="child"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from "vue";
import type { FileDiffPayload, ToolCallDisplay } from "@shared/rpc-types";
import type { ToolEntry } from "../utils/pairToolMessages";
import { formatToolSubject, parseToolCallDisplay } from "../utils/toolCallDisplay";
import FileDiff from "./FileDiff.vue";
import ReadView from "./ReadView.vue";

const props = defineProps<{ entry: ToolEntry }>();

const open = ref(false);
const TOOL_TIMEOUT_MS = 30_000;
const hasTimedOut = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;

const parsedCall = computed(() => {
  const display = parseToolCallDisplay(props.entry.call.content);
  return { display };
});

const display = computed(() => parsedCall.value.display);
const hasChildren = computed(() => props.entry.children.length > 0);

// Outcome icon: spinner while running, check on success, times on error
const parsedResult = computed(() => {
  if (!props.entry.result) return null;
  try {
    return JSON.parse(props.entry.result.content) as {
      type?: string;
      tool_use_id?: string;
      content?: string;
      detailedContent?: string;
      contents?: Array<Record<string, unknown>>;
      is_error?: boolean;
      writtenFiles?: FileDiffPayload[];
    };
  } catch {
    return null;
  }
});

type DisplayBlock = {
  key: string;
  label: string;
  content: string;
};

const statusIcon = computed(() => {
  if (!props.entry.result) return hasTimedOut.value ? "pi-question-circle" : "pi-spin pi-spinner";
  return parsedResult.value?.is_error ? "pi-times-circle" : "pi-check-circle";
});

const statusIconStyle = computed(() => {
  if (!props.entry.result) {
    return hasTimedOut.value ? { color: "#94a3b8" } : undefined;
  }
  return { color: parsedResult.value?.is_error ? "#dc2626" : "#16a34a" };
});

const fullSubject = computed(() => parsedCall.value.display?.subject ?? "");

const primaryArg = computed(() => {
  const s = fullSubject.value;
  return formatToolSubject(s, 80);
});

const readFileStartLine = computed(() => {
  const startLine = parsedCall.value.display?.startLine;
  return typeof startLine === "number" && startLine > 0 ? startLine : undefined;
});

const truncated = computed(() => {
  const c = displayContent.value;
  return c.length > 800 ? c.slice(0, 800) + "\n…[truncated]" : c;
});

const displayContent = computed(() => {
  const parsed = parsedResult.value;
  if (parsed?.detailedContent?.trim()) return parsed.detailedContent.trim();

  const contentBlocks = parsed?.contents ?? [];
  const textFromBlocks = contentBlocks
    .flatMap((block) => {
      if (block.type === "text" && typeof block.text === "string") return [block.text];
      if (block.type === "terminal" && typeof block.text === "string") return [block.text];
      return [];
    })
    .join("\n\n")
    .trim();
  if (textFromBlocks) return textFromBlocks;

  return (parsed?.content ?? props.entry.result?.content ?? "").trim();
});

const displayBlocks = computed<DisplayBlock[]>(() => {
  const parsed = parsedResult.value;
  const blocks = parsed?.contents ?? [];
  return blocks.flatMap((block, index) => {
    const label = block.type === "terminal"
      ? "Terminal output"
      : block.type === "text"
        ? "Text output"
        : "Output block";

    const text = typeof block.text === "string"
      ? block.text
      : typeof block.content === "string"
        ? block.content
        : "";

    if (text.trim()) {
      return [{ key: `${block.type ?? "block"}-${index}`, label, content: text.trim() }];
    }

    if (block.type === "text" || block.type === "terminal") {
      return [];
    }

    const fallback = JSON.stringify(block, null, 2).trim();
    return fallback
      ? [{ key: `${block.type ?? "block"}-${index}`, label, content: fallback }]
      : [];
  });
});

const hasOutput = computed(() => displayContent.value.length > 0);

const effectiveDiffPayloads = computed<FileDiffPayload[]>(() => {
  return parsedResult.value?.writtenFiles ?? [];
});

const totalAdded = computed(() => {
  return effectiveDiffPayloads.value.reduce((sum, payload) => sum + (payload.added ?? 0), 0);
});

const totalRemoved = computed(() => {
  return effectiveDiffPayloads.value.reduce((sum, payload) => sum + (payload.removed ?? 0), 0);
});

function clearTimeoutHandle() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function syncTimeoutState() {
  clearTimeoutHandle();

  if (props.entry.result) {
    hasTimedOut.value = false;
    return;
  }

  const createdAt = new Date(props.entry.call.createdAt).getTime();
  if (!Number.isFinite(createdAt)) {
    hasTimedOut.value = true;
    return;
  }

  const remaining = TOOL_TIMEOUT_MS - (Date.now() - createdAt);
  if (remaining <= 0) {
    hasTimedOut.value = true;
    return;
  }

  hasTimedOut.value = false;
  timeoutId = setTimeout(() => {
    hasTimedOut.value = true;
    timeoutId = null;
  }, remaining);
}

watch(
  () => [props.entry.result?.id ?? null, props.entry.call.createdAt] as const,
  syncTimeoutState,
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTimeoutHandle();
});
</script>

<style scoped>
.tcg {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
}

/* ── Collapsed header ────────────────────────────────────────────── */

.tcg__header {
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

.tcg__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.tcg__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.tcg__tool-icon {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.72rem;
  flex-shrink: 0;
}

.tcg__tool-name {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--p-primary-color, #6366f1);
  font-weight: 600;
  flex-shrink: 0;
}

.tcg__primary-arg {
  font-family: monospace;
  font-size: 0.71rem;
  color: var(--p-text-muted-color, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.tcg__badge {
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

.tcg__badge-icon {
  font-size: 0.6rem;
}

.tcg__stat {
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.67rem;
  font-weight: 700;
  flex-shrink: 0;
  font-family: monospace;
}

.tcg__stat--added {
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.tcg__stat--removed {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-700, #b91c1c);
}

/* ── Expanded body ────────────────────────────────────────────────── */

.tcg__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
  background: var(--p-surface-0, #fff);
}

.tcg__body--flush {
  padding: 0;
}

.tcg__blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tcg__block {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.tcg__block-label {
  padding: 6px 10px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tcg__output {
  margin: 0;
  font-family: monospace;
  font-size: 0.71rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  color: var(--p-text-color, #1e293b);
  line-height: 1.5;
}

.tcg__output--block {
  padding: 8px 10px;
}

.tcg__empty {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}

.tcg__children {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--p-surface-200, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

<style>
html.dark-mode .tcg {
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}
html.dark-mode .tcg__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__body {
  background: var(--p-surface-900, #0f172a);
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__block {
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__block-label {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__stat--added {
  background: color-mix(in srgb, var(--p-green-500) 20%, transparent);
  color: var(--p-green-400);
}
html.dark-mode .tcg__stat--removed {
  background: color-mix(in srgb, var(--p-red-500) 20%, transparent);
  color: var(--p-red-400);
}
html.dark-mode .tcg__badge {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}
html.dark-mode .tcg__children {
  border-left-color: var(--p-surface-700, #334155);
}
</style>
