<template>
  <div
    :class="['conv-body', { 'conv-body--positioning': !initialScrollReady }]"
    ref="scrollEl"
    @scroll.passive="onScroll"
    @wheel.passive="onUserScroll"
    @touchmove.passive="onTouchMove"
  >
    <div class="conv-body__inner conversation-inner">
      <!-- Sentinel for loading older history via IntersectionObserver -->
      <div ref="sentinelEl" class="conv-body__sentinel">
        <div v-if="props.isLoadingOlder" class="conv-body__system">
          <ProgressSpinner style="width: 16px; height: 16px" />
          <span>Loading older messages…</span>
        </div>
      </div>
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
          <SubagentBlock
            v-if="displayItems[vitem.index].kind === 'tool_entry' && isSubagentEntry(asToolEntry(vitem.index).entry)"
            v-bind="subagentEntryProps(asToolEntry(vitem.index).entry)"
            :renderMd="renderMd"
          />
          <ToolCallGroup
            v-else-if="displayItems[vitem.index].kind === 'tool_entry'"
            :entry="asToolEntry(vitem.index).entry"
          />
          <CodeReviewCard
            v-else-if="displayItems[vitem.index].kind === 'code_review'"
            :message="asCodeReview(vitem.index).message"
          />
          <TransitionEventCard
            v-else-if="displayItems[vitem.index].kind === 'single' && asSingle(vitem.index).message.type === 'transition_event'"
            :message="asSingle(vitem.index).message"
          />
          <div
            v-else-if="displayItems[vitem.index].kind === 'stream_tail'"
            class="conv-body__tail"
          >
            <template v-if="hasStructuredTail && props.streamState">
              <StreamBlockNode
                v-for="rootId in props.streamState.roots"
                :key="rootId"
                :blockId="rootId"
                :blocks="props.streamState.blocks"
                :renderMd="renderMd"
  
              />
              <div
                v-if="props.streamState.statusMessage"
                class="conv-body__system"
              >
                <ProgressSpinner style="width: 16px; height: 16px" />
                <span>{{ props.streamState.statusMessage }}</span>
              </div>
            </template>
          </div>
          <MessageBubble
            v-else
            :chunk="asSingle(vitem.index).message"
            :index="asSingle(vitem.index).msgIndex"
          />
        </div>
      </div>

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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { useMarkdown } from "../composables/useMarkdown";
import ProgressSpinner from "primevue/progressspinner";
import MessageBubble from "./MessageBubble.vue";
import TransitionEventCard from "./TransitionEventCard.vue";
import ToolCallGroup from "./ToolCallGroup.vue";
import SubagentBlock from "./SubagentBlock.vue";
import { pairToolMessages, type ToolEntry } from "../utils/pairToolMessages";
import StreamBlockNode from "./StreamBlockNode.vue";
import CodeReviewCard from "./CodeReviewCard.vue";
import type { ConversationMessage } from "@shared/rpc-types";
import type { ConversationStreamState } from "../stores/conversation";

const props = defineProps<{
  messages: ConversationMessage[];
  streamState?: ConversationStreamState | null;
  executionState: string;
  // selfId = conversationId; kept for scroll tracking
  selfId?: number | null;
  hasMoreBefore?: boolean;
  isLoadingOlder?: boolean;
}>();

const emit = defineEmits<{
  (e: "load-older"): void;
}>();

// ─── Message grouping ─────────────────────────────────────────────────────────

const TOOL_MSG_TYPES = new Set(["tool_call", "tool_result", "file_diff"]);

type DisplayItem =
  | { kind: "tool_entry"; entry: ToolEntry; key: string }
  | { kind: "code_review"; message: ConversationMessage; key: string }
  | { kind: "single"; message: ConversationMessage; msgIndex: number; key: string }
  | { kind: "stream_tail"; key: string };

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
  if (hasStructuredTail.value) {
    items.push({ kind: "stream_tail", key: "stream-tail" });
  }
  return items;
});

type ToolEntryItem = Extract<DisplayItem, { kind: "tool_entry" }>;
type CodeReviewItem = Extract<DisplayItem, { kind: "code_review" }>;
type SingleItem = Extract<DisplayItem, { kind: "single" }>;

function asToolEntry(i: number) { return displayItems.value[i] as ToolEntryItem; }
function asCodeReview(i: number) { return displayItems.value[i] as CodeReviewItem; }
function asSingle(i: number) { return displayItems.value[i] as SingleItem; }

function parseEntryFunctionName(entry: ToolEntry): string | null {
  try {
    const p = JSON.parse(entry.call.content) as { function?: { name?: string } };
    return p.function?.name ?? null;
  } catch { return null; }
}

function parseEntryArguments(entry: ToolEntry): Record<string, unknown> | null {
  try {
    const p = JSON.parse(entry.call.content) as { function?: { arguments?: string } };
    if (!p.function?.arguments) return null;
    return JSON.parse(p.function.arguments) as Record<string, unknown>;
  } catch { return null; }
}

function isSubagentEntry(entry: ToolEntry): boolean {
  return parseEntryFunctionName(entry) === "subagent";
}


function subagentEntryProps(entry: ToolEntry) {
  const args = parseEntryArguments(entry);
  let resultContent: string | undefined;
  if (entry.result) {
    try {
      const r = JSON.parse(entry.result.content) as { content?: Array<{ text?: string }> };
      resultContent = r.content?.map((c) => c.text ?? "").join("") || undefined;
    } catch {
      resultContent = entry.result.content;
    }
  }
  return {
    intent: (args?.intent as string) ?? "Subagent",
    prompt: (args?.prompt as string) ?? "",
    done: !!entry.result,
    isError: false,
    result: resultContent,
    childEntries: entry.children,
  };
}

const hasStructuredTail = computed(() => {
  const state = props.streamState;
  return Boolean(state && !state.isDone && (state.roots.length > 0 || state.statusMessage));
});

const hasLiveContent = computed(() => {
  const state = props.streamState;
  return Boolean(state && !state.isDone && state.roots.length > 0);
});

const hasVisibleStreamingState = computed(() => hasStructuredTail.value);

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
    if (item.kind === "stream_tail") return 180;
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

// Disable autoscroll when user drifts this far from the bottom.
const SCROLL_THRESHOLD = 60;
// Re-engage autoscroll when the user scrolls back within this distance.
const REENGAGE_THRESHOLD = 5;

const autoScroll = ref(true);
const pendingScrollBottom = ref(false);
const initialScrollReady = ref(false);
let initialScrollRun = 0;

// True while we are programmatically scrolling — suppresses onScroll handler
// so it cannot accidentally disengage autoscroll.
let programmaticScrolling = false;

// True during the wheel+scroll event pair that fires when the user scrolls up.
// Prevents onScroll from immediately re-engaging autoScroll via REENGAGE_THRESHOLD.
let userScrolling = false;

function scrollToBottom(behavior: ScrollBehavior = "auto") {
  if (!scrollEl.value) return;
  programmaticScrolling = true;
  scrollEl.value.scrollTo({ top: scrollEl.value.scrollHeight, behavior });
  requestAnimationFrame(() => { programmaticScrolling = false; });
}

function scrollToLatest(behavior: ScrollBehavior = "auto") {
  scrollToBottom(behavior);
}

// Disengage autoscroll on upward wheel. Only set for upward direction so
// downward wheel (returning to bottom) doesn't block re-engagement.
function onUserScroll(e: WheelEvent) {
  if (e.deltaY >= 0) return;
  // Mark that this scroll event is user-initiated so onScroll won't
  // immediately re-engage autoScroll via REENGAGE_THRESHOLD.
  userScrolling = true;
  autoScroll.value = false;
  pendingScrollBottom.value = false;
  // Abort any in-flight smooth-scroll animation so the browser stops
  // animating toward the bottom and the user's upward scroll takes effect.
  if (scrollEl.value) {
    scrollEl.value.scrollTo({ top: scrollEl.value.scrollTop, behavior: "instant" });
  }
  // Cancel TanStack Virtual's internal RAF reconcile loop.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (virtualizer.value && (virtualizer.value as any).scrollState) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (virtualizer.value as any).scrollState = null;
  }
}

// For touch (trackpad / mobile): disengage only when swiping upward.
let touchStartY = 0;
function onTouchMove(e: TouchEvent) {
  const y = e.touches[0]?.clientY ?? 0;
  if (y > touchStartY) {
    autoScroll.value = false;
    pendingScrollBottom.value = false;
  }
  touchStartY = y;
}

function onScroll() {
  if (!scrollEl.value || programmaticScrolling) return;
  const scrollingByUser = userScrolling;
  userScrolling = false;
  const { scrollTop, scrollHeight, clientHeight } = scrollEl.value;
  const distFromBottom = scrollHeight - scrollTop - clientHeight;
  // Skip re-engagement if this scroll event is paired with an upward wheel
  // (the viewport hasn't moved yet so distFromBottom is still near zero).
  if (!scrollingByUser && distFromBottom < REENGAGE_THRESHOLD) autoScroll.value = true;
  else if (distFromBottom >= SCROLL_THRESHOLD) autoScroll.value = false;
}

async function scheduleScrollToBottom({ revealWhenDone = false }: { revealWhenDone?: boolean } = {}) {
  const runId = ++initialScrollRun;
  autoScroll.value = true;
  pendingScrollBottom.value = true;
  await nextTick();
  if (runId !== initialScrollRun) return;
  scrollToBottom();
  requestAnimationFrame(() => {
    if (runId !== initialScrollRun) return;
    if (autoScroll.value) scrollToBottom();
    pendingScrollBottom.value = false;
    if (revealWhenDone) initialScrollReady.value = true;
  });
}

// During initial load: scroll to bottom once virtualizer measures its content.
watch(
  () => virtualizer.value.getTotalSize(),
  () => { if (pendingScrollBottom.value && autoScroll.value) scrollToBottom(); },
);

// RAF loop keeps scroll pinned to bottom during live streaming.
// This is the single authority during streaming — other watchers step aside.
{
  let rafId: number | null = null;

  function rafScrollLoop() {
    if (!hasLiveContent.value) { rafId = null; return; }
    if (autoScroll.value) scrollToBottom();
    rafId = requestAnimationFrame(rafScrollLoop);
  }

  watch(hasLiveContent, (live) => {
    if (live && rafId === null) rafId = requestAnimationFrame(rafScrollLoop);
  });

  onUnmounted(() => { if (rafId !== null) cancelAnimationFrame(rafId); });
}

watch(
  [
    // Track last message ID — prepending older messages doesn't trigger scroll.
    () => props.messages.at(-1)?.id,
    () => props.executionState,
    () => props.streamState?.roots.length,
  ],
  async ([newLastId], [oldLastId]) => {
    if (!autoScroll.value) return;
    // Skip during active streaming — the RAF loop handles it.
    if (hasLiveContent.value) return;
    await nextTick();
    if (!autoScroll.value) return;
    if (!scrollEl.value) return;
    // On initial load (oldLastId undefined) always scroll to bottom regardless
    // of current position — the user just opened the view and needs to see latest.
    if (oldLastId == null) {
      scrollToLatest("auto");
      return;
    }
    // Skip when stream blocks just cleared but no new persisted message arrived yet.
    // The RAF loop was tracking scroll during streaming; when roots go to 0 the stream
    // DOM is removed but message.new hasn't fired yet, so scrollHeight only reaches the
    // user's last message. The watch will fire again with a new newLastId once the
    // assistant's persisted message arrives.
    if (newLastId === oldLastId) return;
    // Always scroll when the user sends a message, regardless of current position.
    const lastMessage = props.messages.at(-1);
    const isSentByUser = lastMessage?.role === "user" || lastMessage?.type === "user";
    if (isSentByUser) {
      scrollToLatest("smooth");
      return;
    }
    // A new persisted assistant message arrived — scroll to it.
    // No threshold guard: autoScroll is already the guard (user is near the bottom).
    scrollToLatest("smooth");
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

// ─── Older history loading ────────────────────────────────────────────────────

const sentinelEl = ref<HTMLElement | null>(null);
let sentinelObserver: IntersectionObserver | null = null;

function setupSentinelObserver() {
  if (sentinelObserver) {
    sentinelObserver.disconnect();
    sentinelObserver = null;
  }
  if (!sentinelEl.value) return;
  sentinelObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && props.hasMoreBefore && !props.isLoadingOlder) {
        emit("load-older");
      }
    },
    { root: scrollEl.value, threshold: 0 },
  );
  sentinelObserver.observe(sentinelEl.value);
  // The IntersectionObserver only fires on changes — if the sentinel is already
  // visible when we attach (e.g. short conversation), trigger an immediate check.
  if (props.hasMoreBefore && !props.isLoadingOlder && !autoScroll.value) {
    const sentinel = sentinelEl.value.getBoundingClientRect();
    const container = scrollEl.value?.getBoundingClientRect();
    if (container && sentinel.top >= container.top && sentinel.bottom <= container.bottom) {
      emit("load-older");
    }
  }
}

onMounted(setupSentinelObserver);
onUnmounted(() => sentinelObserver?.disconnect());

watch(
  () => props.hasMoreBefore,
  () => void nextTick(setupSentinelObserver),
);

watch(autoScroll, (newVal, oldVal) => {
  if (!oldVal || newVal) return; // only act on true → false transition
  if (!scrollEl.value || !sentinelEl.value) return;
  if (!props.hasMoreBefore || props.isLoadingOlder) return;
  const sentinel = sentinelEl.value.getBoundingClientRect();
  const container = scrollEl.value.getBoundingClientRect();
  if (sentinel.top >= container.top && sentinel.bottom <= container.bottom) {
    emit("load-older");
  }
});

// ─── Scroll restoration on older-message prepend ─────────────────────────────

let savedScrollHeight = 0;
let savedScrollTop = 0;

watch(
  () => props.messages[0]?.id,
  (newId, oldId) => {
    if (oldId != null && newId != null && newId < oldId) {
      savedScrollHeight = scrollEl.value?.scrollHeight ?? 0;
      savedScrollTop = scrollEl.value?.scrollTop ?? 0;
    }
  },
  { flush: "pre" },
);

// Apply scroll restoration synchronously in the post-flush tick so it always
// completes before any external scrollTop assignment (e.g. Playwright CDP eval)
// can arrive. Using absolute assignment (savedScrollTop + delta) rather than
// += avoids clobbering a concurrent external scrollTop=0 with a stale delta.
watch(
  () => props.messages[0]?.id,
  (newId, oldId) => {
    if (oldId != null && newId != null && newId < oldId && savedScrollHeight > 0 && scrollEl.value) {
      const delta = scrollEl.value.scrollHeight - savedScrollHeight;
      scrollEl.value.scrollTop = savedScrollTop + delta;
      savedScrollHeight = 0;
      savedScrollTop = 0;
    }
  },
  { flush: "post" },
);

const { renderMd } = useMarkdown();

// Called by ConversationDrawer.onAfterShow — scroll to bottom only when the
// user hasn't manually scrolled away (autoScroll still engaged).
// Runs a multi-frame RAF loop: reads scrollHeight at the top of each frame
// (after DOM/ResizeObserver have settled) so the virtualizer can finish
// measuring items (e.g. 240-message initial loads) before we stop.
function scheduleScrollToBottomIfAuto() {
  if (!autoScroll.value) return;
  pendingScrollBottom.value = true;
  let stableFrames = 0;
  let lastScrollHeight = -1;
  let maxFrames = 60; // safety valve: ~1 s at 60 fps
  const stabilize = () => {
    // Read scrollHeight FIRST (DOM is settled at the top of each RAF, after
    // microtasks + ResizeObserver from the previous frame's scroll have run).
    const sh = scrollEl.value?.scrollHeight ?? 0;
    if (sh === lastScrollHeight) stableFrames++;
    else { stableFrames = 0; lastScrollHeight = sh; }
    maxFrames--;
    if (!autoScroll.value || maxFrames <= 0 || stableFrames >= 3) {
      pendingScrollBottom.value = false;
      return;
    }
    // Scroll to current bottom, then wait one frame for DOM to update.
    scrollToBottom();
    requestAnimationFrame(stabilize);
  };
  requestAnimationFrame(stabilize);
}

defineExpose({ scrollToBottom, scheduleScrollToBottomIfAuto });
</script>

<style scoped>

.conv-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 12px 8px 12px;
  will-change: scroll-position;
  overflow-anchor: none;
  scrollbar-gutter: stable;
}

.conv-body--positioning {
  visibility: hidden;
}

.conv-body__sentinel {
  min-height: 1px;
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

.conv-body__tail {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
