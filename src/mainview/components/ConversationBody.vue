<template>
  <div
    :class="['conv-body', { 'conv-body--positioning': !initialScrollReady }]"
    ref="scrollEl"
    @scroll.passive="onScroll"
  >
    <div class="conv-body__inner conversation-inner">
      <!-- Virtual list spacer -->
      <div :style="{ position: 'relative', height: `${virtualizer.getTotalSize()}px` }">
        <div
          v-for="vitem in virtualizer.getVirtualItems()"
          :key="vitem.key"
          :ref="measureRef"
          :data-index="vitem.index"
          :style="{
            position: 'absolute',
            top: 0,
            width: '100%',
            paddingBottom: '8px',
            transform: `translateY(${vitem.start}px)`,
          }"
        >
          <ToolCallGroup
            v-if="displayItems[vitem.index].kind === 'tool_entry'"
            :entry="asToolEntry(vitem.index).entry"
          />
          <CodeReviewCard
            v-else-if="displayItems[vitem.index].kind === 'code_review'"
            :message="asCodeReview(vitem.index).message"
          />
          <MessageBubble
            v-else
            :chunk="asSingle(vitem.index).message"
            :index="asSingle(vitem.index).msgIndex"
          />
        </div>
      </div>

      <!-- Unified stream blocks -->
      <template v-if="props.streamState && props.streamState.roots.length > 0">
        <StreamBlockNode
          v-for="rootId in props.streamState.roots"
          :key="rootId"
          :blockId="rootId"
          :blocks="props.streamState.blocks"
          :renderMd="renderMd"
          :version="props.streamVersion"
        />
      </template>
      <!-- Ephemeral status message (pipeline path) -->
      <div
        v-if="props.streamState && !props.streamState.isDone && props.streamState.statusMessage"
        class="conv-body__system"
      >
        <ProgressSpinner style="width: 16px; height: 16px" />
        <span>{{ props.streamState.statusMessage }}</span>
      </div>

      <!-- Legacy streaming (non-pipeline path) -->
      <template v-else-if="!props.streamState">
        <ReasoningBubble
          v-if="props.streamingReasoningToken && isLegacyStreamVisible"
          :content="props.streamingReasoningToken"
          :streaming="true"
          key="live-reasoning"
        />
        <div
          v-if="props.streamingToken && isLegacyStreamVisible"
          class="msg msg--assistant"
        >
          <div class="msg__bubble prose streaming" v-html="renderMd(props.streamingToken)" />
          <div class="msg__meta">AI<span class="cursor">▌</span></div>
        </div>
        <div
          v-else-if="props.streamingStatusMessage && isLegacyStreamVisible"
          class="conv-body__system"
        >
          <ProgressSpinner style="width: 16px; height: 16px" />
          <span>{{ props.streamingStatusMessage }}</span>
        </div>
      </template>

      <!-- Running spinner when no tokens yet -->
      <div
        v-if="props.executionState === 'running' && !hasLiveContent && !hasVisibleStreamingState"
        class="conv-body__system"
      >
        <ProgressSpinner style="width: 20px; height: 20px" />
        <span>Thinking…</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { marked } from "marked";
import ProgressSpinner from "primevue/progressspinner";
import MessageBubble from "./MessageBubble.vue";
import ToolCallGroup from "./ToolCallGroup.vue";
import { pairToolMessages, type ToolEntry } from "../utils/pairToolMessages";
import ReasoningBubble from "./ReasoningBubble.vue";
import StreamBlockNode from "./StreamBlockNode.vue";
import CodeReviewCard from "./CodeReviewCard.vue";
import type { ConversationMessage } from "@shared/rpc-types";
import type { ConversationStreamState } from "../stores/conversation";

const props = defineProps<{
  messages: ConversationMessage[];
  streamState?: ConversationStreamState | null;
  streamVersion?: number;
  executionState: string;
  // Legacy streaming compat
  streamingToken?: string;
  streamingReasoningToken?: string;
  streamingStatusMessage?: string;
  streamingActiveId?: number | null;
  // selfId = conversationId; filters legacy streaming to this conversation only
  selfId?: number | null;
}>();

// ─── Message grouping ─────────────────────────────────────────────────────────

const TOOL_MSG_TYPES = new Set(["tool_call", "tool_result", "file_diff"]);

type DisplayItem =
  | { kind: "tool_entry"; entry: ToolEntry; key: string }
  | { kind: "code_review"; message: ConversationMessage; key: string }
  | { kind: "single"; message: ConversationMessage; msgIndex: number; key: string };

const displayItems = computed<DisplayItem[]>(() => {
  const msgs = props.messages;
  const items: DisplayItem[] = [];
  let i = 0;
  while (i < msgs.length) {
    if (msgs[i].type === "code_review") {
      items.push({ kind: "code_review", message: msgs[i], key: `cr-${msgs[i].id}` });
      i++;
      if (i < msgs.length && msgs[i].type === "user" && msgs[i].content.startsWith("=== Code Review ===")) {
        i++;
      }
    } else if (TOOL_MSG_TYPES.has(msgs[i].type)) {
      const toolMsgs: ConversationMessage[] = [];
      while (i < msgs.length && TOOL_MSG_TYPES.has(msgs[i].type)) {
        toolMsgs.push(msgs[i]);
        i++;
      }
      const entries = pairToolMessages(toolMsgs);
      for (const entry of entries) {
        const meta = entry.call.metadata as Record<string, unknown> | null;
        if (typeof meta?.parent_tool_call_id === "string") continue;
        items.push({ kind: "tool_entry", entry, key: `e-${entry.call.id}` });
      }
    } else {
      items.push({ kind: "single", message: msgs[i], msgIndex: i, key: `s-${msgs[i].id}` });
      i++;
    }
  }
  return items;
});

type ToolEntryItem = Extract<DisplayItem, { kind: "tool_entry" }>;
type CodeReviewItem = Extract<DisplayItem, { kind: "code_review" }>;
type SingleItem = Extract<DisplayItem, { kind: "single" }>;

function asToolEntry(i: number) { return displayItems.value[i] as ToolEntryItem; }
function asCodeReview(i: number) { return displayItems.value[i] as CodeReviewItem; }
function asSingle(i: number) { return displayItems.value[i] as SingleItem; }

const hasLiveContent = computed(() => {
  const state = props.streamState;
  if (!state || state.isDone) return false;
  return state.roots.length > 0;
});

const isLegacyStreamVisible = computed(() =>
  props.selfId == null || props.streamingActiveId === props.selfId,
);

const hasVisibleStreamingState = computed(() => {
  const state = props.streamState;
  if (state && !state.isDone && (state.roots.length > 0 || !!state.statusMessage)) return true;
  if (!props.streamState && isLegacyStreamVisible.value) {
    return Boolean(props.streamingReasoningToken || props.streamingToken || props.streamingStatusMessage);
  }
  return false;
});

// ─── Virtualizer ─────────────────────────────────────────────────────────────

const scrollEl = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(computed(() => ({
  count: displayItems.value.length,
  getScrollElement: () => scrollEl.value,
  getItemKey: (index) => displayItems.value[index]?.key ?? index,
  estimateSize: (index) => {
    const item = displayItems.value[index];
    if (!item) return 80;
    if (item.kind === "single") return 80;
    if (item.kind === "code_review") return 300;
    return 36;
  },
  overscan: 15,
})));

function measureRef(el: Element | null) {
  if (!el) return;
  const index = parseInt((el as HTMLElement).dataset.index ?? "-1");
  if (index >= 0) {
    virtualizer.value.resizeItem(index, (el as HTMLElement).offsetHeight);
  }
  virtualizer.value.measureElement(el);
}

// ─── Auto-scroll ─────────────────────────────────────────────────────────────

const SCROLL_THRESHOLD = 60;
const autoScroll = ref(true);
const pendingScrollBottom = ref(false);
const initialScrollReady = ref(false);
let initialScrollRun = 0;

function onScroll() {
  if (!scrollEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollEl.value;
  autoScroll.value = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
}

function scrollToBottom(behavior: ScrollBehavior = "auto") {
  if (!scrollEl.value) return;
  scrollEl.value.scrollTo({ top: scrollEl.value.scrollHeight, behavior });
}

function scrollToLatest(behavior: ScrollBehavior = "auto") {
  const lastIndex = displayItems.value.length - 1;
  if (lastIndex >= 0) {
    virtualizer.value.scrollToIndex(lastIndex, {
      align: "end",
      behavior: behavior === "smooth" ? "smooth" : "auto",
    });
  }
  scrollToBottom(behavior);
}

async function scheduleScrollToBottom({ revealWhenDone = false }: { revealWhenDone?: boolean } = {}) {
  const runId = ++initialScrollRun;
  autoScroll.value = true;
  pendingScrollBottom.value = true;
  await nextTick();
  if (runId !== initialScrollRun) return;
  scrollToLatest();
  requestAnimationFrame(() => {
    if (runId !== initialScrollRun) return;
    scrollToLatest();
  });
  setTimeout(() => {
    if (runId !== initialScrollRun) return;
    scrollToLatest();
    pendingScrollBottom.value = false;
    if (revealWhenDone) initialScrollReady.value = true;
  }, 60);
}

watch(
  () => virtualizer.value.getTotalSize(),
  () => { if (pendingScrollBottom.value) scrollToLatest(); },
);

watch(
  [
    () => props.messages.length,
    () => props.streamingToken?.length ?? 0,
    () => props.streamingReasoningToken?.length ?? 0,
    () => props.streamingStatusMessage?.length ?? 0,
    () => props.executionState,
    () => props.streamVersion ?? 0,
  ],
  async ([newMsgLen], [oldMsgLen]) => {
    await nextTick();
    if (!autoScroll.value) return;
    scrollToLatest(newMsgLen !== oldMsgLen ? "smooth" : "auto");
  },
);

watch(
  () => props.selfId,
  (newId, oldId) => {
    if (newId != null && newId !== oldId) {
      initialScrollReady.value = false;
      virtualizer.value.measure();
      void scheduleScrollToBottom({ revealWhenDone: true });
    }
  },
  { immediate: true },
);

onMounted(() => {
  initialScrollReady.value = false;
  virtualizer.value.measure();
  void scheduleScrollToBottom({ revealWhenDone: true });
});

function renderMd(content: string): string {
  return marked.parse(content, { async: false, breaks: true, gfm: true }) as string;
}
</script>

<style scoped>
.conv-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 8px 12px;
  will-change: scroll-position;
  overflow-anchor: none;
}

.conv-body--positioning {
  visibility: hidden;
}

.conv-body__inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conv-body__system {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
  padding: 4px 0;
}

/* ── message bubble styles (mirrored from ConversationPanel) ─────────────── */
.msg {
  display: flex;
  flex-direction: column;
}

.msg--assistant {
  align-items: flex-start;
}

.msg--assistant .msg__bubble {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px 12px 12px 2px;
  padding: 10px 14px;
  max-width: 85%;
  word-break: break-word;
}

.msg--assistant .msg__bubble :deep(p) { margin: 0 0 0.6em; line-height: 1.6; }
.msg--assistant .msg__bubble :deep(p:last-child) { margin-bottom: 0; }
.msg--assistant .msg__bubble :deep(h1), .msg--assistant .msg__bubble :deep(h2),
.msg--assistant .msg__bubble :deep(h3), .msg--assistant .msg__bubble :deep(h4) {
  font-weight: 600; margin: 0.8em 0 0.3em; line-height: 1.3;
}
.msg--assistant .msg__bubble :deep(ul), .msg--assistant .msg__bubble :deep(ol) {
  margin: 0.4em 0 0.6em 1.4em; padding: 0;
}
.msg--assistant .msg__bubble :deep(li) { margin: 0.15em 0; line-height: 1.5; }
.msg--assistant .msg__bubble :deep(code) {
  font-family: ui-monospace, monospace; font-size: 0.82em;
  background: var(--p-content-hover-background); border-radius: 4px; padding: 1px 5px;
}
.msg--assistant .msg__bubble :deep(pre) {
  background: var(--p-surface-900, #0f172a); color: var(--p-surface-100, #f1f5f9);
  border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0.6em 0;
  font-size: 0.8rem; line-height: 1.5;
}
.msg--assistant .msg__bubble :deep(pre code) { background: none; padding: 0; color: inherit; }

.msg__meta {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-top: 2px;
  padding: 0 4px;
}

.cursor {
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
</style>
