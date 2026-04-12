<template>
  <template v-if="block">
    <!-- Reasoning (live chunk or persisted) -->
    <ReasoningBubble
      v-if="block.type === 'reasoning_chunk' || block.type === 'reasoning'"
      :content="block.content"
      :streaming="!block.done && block.type === 'reasoning_chunk'"
    />

    <!-- Text (live chunk or persisted assistant) -->
    <div
      v-else-if="block.type === 'text_chunk' || block.type === 'assistant'"
      class="msg msg--assistant"
    >
      <div
        :class="['msg__bubble', 'prose', { streaming: isLiveText }]"
        v-html="renderMd(block.content)"
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

    <!-- Children for non-tool blocks (tool_call renders children in its body) -->
    <template v-if="block.type !== 'tool_call' && block.children.length > 0">
      <StreamBlockNode
        v-for="childId in block.children"
        :key="childId"
        :blockId="childId"
        :blocks="blocks"
        :renderMd="renderMd"
      />
    </template>
  </template>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { StreamBlock } from "../stores/task";
import ReasoningBubble from "./ReasoningBubble.vue";

const props = defineProps<{
  blockId: string;
  blocks: Map<string, StreamBlock>;
  renderMd: (md: string) => string;
}>();

const open = ref(false);

const block = computed(() => props.blocks.get(props.blockId));

const isLiveText = computed(() => {
  const b = block.value;
  return b ? !b.done && b.type === "text_chunk" : false;
});

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
