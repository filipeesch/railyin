<template>
  <template v-if="block">
    <!-- Reasoning (live chunk or persisted) -->
    <ReasoningBubble
      v-if="block.type === 'reasoning_chunk' || block.type === 'reasoning'"
      :content="isLiveReasoning ? typewriterReasoning : block.content"
      :streaming="isLiveReasoning"
    >
      <div v-if="block.children.length > 0" class="rb__children">
        <StreamBlockNode
          v-for="childId in block.children"
          :key="childId"
          :blockId="childId"
          :blocks="blocks"
          :renderMd="renderMd"
          :version="version"
        />
      </div>
    </ReasoningBubble>

    <!-- Text (live chunk or persisted assistant) -->
    <div
      v-else-if="block.type === 'text_chunk' || block.type === 'assistant'"
      class="msg msg--assistant"
    >
      <div
        :class="['msg__bubble', 'prose', { streaming: isLiveText }]"
        v-html="renderMd(isLiveText ? typewriterText : block.content)"
      />
      <div class="msg__meta">
        AI
        <span v-if="isLiveText" class="cursor">▌</span>
      </div>
    </div>

    <!-- Tool call (collapsible with children inside) -->
    <div v-else-if="block.type === 'tool_call'" class="tcg">
      <button class="tcg__header" @click="open = !open">
        <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'tcg__chevron']" />
        <i :class="['pi', toolStatusIcon, 'tcg__tool-icon']" :style="toolStatusStyle" />
        <code class="tcg__tool-name">{{ toolName }}</code>
        <span v-if="toolPrimaryArg" class="tcg__primary-arg">{{ toolPrimaryArg }}</span>
        <span v-if="block.children.length > 0" class="tcg__badge">
          <i class="pi pi-sitemap tcg__badge-icon" />
          {{ block.children.length }}
        </span>
      </button>
      <div v-if="open" class="tcg__body">
        <pre v-if="toolResultContent" class="tcg__output">{{ toolResultTruncated }}</pre>
        <div v-if="block.children.length > 0" class="tcg__children">
          <StreamBlockNode
            v-for="childId in block.children"
            :key="childId"
            :blockId="childId"
            :blocks="blocks"
            :renderMd="renderMd"
            :version="version"
          />
        </div>
      </div>
    </div>

    <!-- Tool result — skip rendering at root level; shown inside tool_call body -->
    <!-- If orphaned at root (no matching tool_call parent), render as collapsed output -->
    <div v-else-if="block.type === 'tool_result' && !block.parentBlockId" class="tcg">
      <button class="tcg__header" @click="open = !open">
        <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'tcg__chevron']" />
        <i class="pi pi-check-circle tcg__tool-icon" style="color: #16a34a" />
        <code class="tcg__tool-name">tool result</code>
      </button>
      <div v-if="open" class="tcg__body">
        <pre class="tcg__output">{{ truncate(block.content) }}</pre>
      </div>
    </div>

    <!-- File diff -->
    <div v-else-if="block.type === 'file_diff'" class="msg msg--system">
      <span>📄 File changed</span>
    </div>

    <!-- System message -->
    <div v-else-if="block.type === 'system'" class="msg msg--system">
      <span>{{ block.content }}</span>
    </div>

    <!-- User message -->
    <div v-else-if="block.type === 'user'" class="msg msg--user">
      <div class="msg__bubble prose" v-html="renderMd(block.content)" />
    </div>

    <!-- Children for non-tool, non-reasoning blocks (those render children in their own body) -->
    <template v-if="block.type !== 'tool_call' && block.type !== 'reasoning_chunk' && block.type !== 'reasoning' && block.children.length > 0">
      <StreamBlockNode
        v-for="childId in block.children"
        :key="childId"
        :blockId="childId"
        :blocks="blocks"
        :renderMd="renderMd"
        :version="version"
      />
    </template>
  </template>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { StreamBlock } from "../stores/task";
import ReasoningBubble from "./ReasoningBubble.vue";
import { useTypewriter } from "../composables/useTypewriter";

const props = defineProps<{
  blockId: string;
  blocks: Map<string, StreamBlock>;
  renderMd: (md: string) => string;
  version: number;
}>();

const open = ref(false);

// Touch `version` so Vue re-evaluates when any stream event fires.
// Spread into a new object so Vue 3's === check detects the value changed
// and actually re-renders the template (in-place mutation is invisible to Vue).
const block = computed(() => {
  void props.version;
  const b = props.blocks.get(props.blockId);
  return b ? { ...b } : undefined;
});

const isLiveText = computed(() => {
  const b = block.value;
  return b ? !b.done && b.type === "text_chunk" : false;
});

const isLiveReasoning = computed(() => {
  const b = block.value;
  return b ? !b.done && b.type === "reasoning_chunk" : false;
});

// Typewriter animation for live streaming text — reveals characters progressively
// instead of dumping entire token bursts at once.
const typewriterText = useTypewriter(
  () => block.value?.content ?? "",
  () => isLiveText.value,
);

const typewriterReasoning = useTypewriter(
  () => block.value?.content ?? "",
  () => isLiveReasoning.value,
);

// Tool call helpers
const parsedToolCall = computed(() => {
  const b = block.value;
  if (!b || b.type !== "tool_call") return { name: "tool", args: {} as Record<string, unknown> };
  try {
    const p = JSON.parse(b.content) as {
      name?: string;
      function?: { name?: string; arguments?: string | Record<string, unknown> };
      arguments?: string | Record<string, unknown>;
    };
    const name = p?.name ?? p?.function?.name ?? "tool";
    const rawArgs = p?.function?.arguments ?? p?.arguments;
    const args: Record<string, unknown> =
      typeof rawArgs === "string" ? JSON.parse(rawArgs) : (rawArgs ?? {});
    return { name, args };
  } catch {
    return { name: "tool", args: {} as Record<string, unknown> };
  }
});

const toolName = computed(() => parsedToolCall.value.name);

const toolPrimaryArg = computed(() => {
  const { args } = parsedToolCall.value;
  const val = String(args.path ?? args.from_path ?? args.pattern ?? args.url ?? args.command ?? "");
  return val.length > 60 ? "…" + val.slice(-57) : val;
});

// Find the matching tool_result (same blockId in the parent's children or roots)
const toolResultBlock = computed(() => {
  const b = block.value;
  if (!b || b.type !== "tool_call") return null;
  // tool_result with the same blockId would have been skipped by the store (duplicate blockId).
  // Instead, search siblings for a tool_result block referencing this tool's callId.
  // The tool_result blockId equals the callId in the orchestrator.
  // Since both share the same blockId, the store skips the second one.
  // Check the block's metadata for result info instead.
  const meta = b.metadata ? tryParseJson(b.metadata) : null;
  if (meta?.hasResult) return meta;
  return null;
});

const toolResultContent = computed(() => {
  const r = toolResultBlock.value;
  // Store already extracts plain text from the JSON envelope
  return r?.resultContent ?? "";
});

const toolResultTruncated = computed(() => truncate(toolResultContent.value));

const toolHasResult = computed(() => {
  const b = block.value;
  if (!b) return false;
  // tool_result overwrites the tool_call in the block map if same blockId,
  // but our store skips duplicates. Check metadata or done flag.
  return b.done;
});

const toolStatusIcon = computed(() => {
  if (!toolHasResult.value) return "pi-spin pi-spinner";
  return "pi-check-circle";
});

const toolStatusStyle = computed(() => {
  if (!toolHasResult.value) return undefined;
  return { color: "#16a34a" };
});

function truncate(text: string, max = 800): string {
  return text.length > max ? text.slice(0, max) + "\n…[truncated]" : text;
}

function tryParseJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
</script>

<style scoped>
/* ── Tool call group (mirrors ToolCallGroup.vue styles) ──────────── */

.tcg {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
}

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

.tcg__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
  background: var(--p-surface-0, #fff);
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

.tcg__children {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--p-surface-200, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── Messages ────────────────────────────────────────────────────── */

.msg {
  margin-bottom: 4px;
}

.msg--assistant .msg__bubble {
  padding: 8px 12px;
}

.msg__meta {
  font-size: 0.68rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-top: 2px;
}

.cursor {
  animation: blink 1s step-end infinite;
  color: var(--p-primary-color, #6366f1);
}

.streaming {
  border-left: 2px solid var(--p-primary-color, #6366f1);
  padding-left: 10px;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0; }
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
html.dark-mode .tcg__badge {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}
html.dark-mode .tcg__children {
  border-left-color: var(--p-surface-700, #334155);
}
</style>
