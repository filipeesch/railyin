<template>
  <div
    :class="['conv-body', { 'conv-body--positioning': !initialScrollReady }]"
    ref="scrollEl"
    @scroll.passive="onScroll"
    @wheel.passive="onUserScroll"
    @touchstart.passive="onUserScroll"
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
          <ToolCallGroup
            v-if="displayItems[vitem.index].kind === 'tool_entry'"
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
// Re-engage autoscroll only when the user scrolls fully back to the bottom.
// A tight value prevents flip-flopping when the user just started scrolling up
// but hasn't moved far enough to cross SCROLL_THRESHOLD yet.
const REENGAGE_THRESHOLD = 5;

const autoScroll = ref(true);
const pendingScrollBottom = ref(false);
const initialScrollReady = ref(false);
let initialScrollRun = 0;

// Set synchronously on wheel/touch so the RAF loop sees it before the first
// scroll event fires, eliminating the race where scrollToBottom() overrides the
// user's intended scroll before onScroll() can set autoScroll=false.
const userScrolling = ref(false);

function onUserScroll(e: WheelEvent) {
  // Immediately disengage autoscroll when the user scrolls upward.
  // This is synchronous and fires before the RAF loop's next tick (~16ms),
  // so the loop cannot scroll down between this event and the scroll event.
  if (e.deltaY < 0) {
    autoScroll.value = false;
    // Cancel any pending initial scroll-to-bottom so the getTotalSize watcher
    // does not re-engage autoscroll during the 60ms initialisation window.
    pendingScrollBottom.value = false;
    // Abort any in-flight native smooth-scroll animation (e.g. started by the
    // message-arrival watcher calling scrollToLatest("smooth")).  Without this,
    // the browser keeps animating toward the bottom even though autoScroll is
    // already false, giving the impression of a "jump" the user cannot stop.
    if (scrollEl.value) {
      scrollEl.value.scrollTo({ top: scrollEl.value.scrollTop, behavior: "instant" });
    }
    // TanStack Virtual's internal RAF reconcile loop (scheduleScrollReconcile)
    // keeps re-calling _scrollToOffset until scrollOffset ≈ targetOffset.
    // Nulling scrollState cancels that loop so the virtualizer stops fighting
    // the user's upward scroll.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (virtualizer.value && (virtualizer.value as any).scrollState) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (virtualizer.value as any).scrollState = null;
    }
  }
  userScrolling.value = true;
}

function onScroll() {
  if (!scrollEl.value) return;
  // Capture before reset: true means this scroll event was triggered by an
  // upward wheel gesture already handled in onUserScroll.  Reading it here
  // (before reset) lets us suppress the premature re-engagement that would
  // otherwise happen when the very first scroll-event fires while the viewport
  // is still within REENGAGE_THRESHOLD of the bottom (e.g. 1–4 px from bottom
  // just after the user starts wheeling up from a pinned position).
  const scrollingByUser = userScrolling.value;
  userScrolling.value = false;
  const { scrollTop, scrollHeight, clientHeight } = scrollEl.value;
  const distFromBottom = scrollHeight - scrollTop - clientHeight;
  // Dead zone [REENGAGE_THRESHOLD, SCROLL_THRESHOLD): don't change autoScroll.
  // This prevents the RAF from re-engaging while the user just started scrolling
  // up and hasn't crossed the disable threshold yet.
  //
  // Additionally guard re-engagement when the user is actively scrolling up
  // (scrollingByUser). Without this guard, the very first scroll event after a
  // wheel-up fires while the viewport is still ≤ REENGAGE_THRESHOLD px from the
  // bottom (before the animation has moved the viewport far), causing
  // autoScroll to be re-enabled immediately — then the SIZE watcher fires and
  // snaps the viewport back to the bottom before the user can escape.
  if (distFromBottom < REENGAGE_THRESHOLD && !scrollingByUser) {
    autoScroll.value = true;
  } else if (distFromBottom >= SCROLL_THRESHOLD) {
    autoScroll.value = false;
  }
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
    if (autoScroll.value) scrollToLatest();
  });
  setTimeout(() => {
    if (runId !== initialScrollRun) return;
    if (autoScroll.value) scrollToLatest();
    pendingScrollBottom.value = false;
    if (revealWhenDone) initialScrollReady.value = true;
  }, 60);
}

watch(
  () => virtualizer.value.getTotalSize(),
  () => { if (pendingScrollBottom.value && !userScrolling.value && autoScroll.value) scrollToLatest(); },
);

// While there are live streaming blocks, run a requestAnimationFrame loop to
// keep the scroll position at the bottom as the typewriter animation grows the
// DOM height. The loop stops automatically when streaming ends.
{
  let rafId: number | null = null;

  function rafScrollLoop() {
    if (!hasLiveContent.value) { rafId = null; return; }
    if (autoScroll.value && !userScrolling.value) scrollToBottom();
    rafId = requestAnimationFrame(rafScrollLoop);
  }

  watch(hasLiveContent, (live) => {
    if (live && rafId === null) rafId = requestAnimationFrame(rafScrollLoop);
  });

  onUnmounted(() => { if (rafId !== null) cancelAnimationFrame(rafId); });
}

watch(
  [
    // Track the last message's ID rather than array length so that prepending
    // older messages (loadOlderMessages) does not trigger a scroll-to-bottom.
    // Prepend leaves at(-1)?.id unchanged; append/refresh changes it.
    () => props.messages.at(-1)?.id,
    () => props.executionState,
    () => props.streamState?.roots.length,
  ],
  async ([newLastId], [oldLastId]) => {
    // User has scrolled up — don't re-engage autoscroll on new messages.
    if (!autoScroll.value) return;
    await nextTick();
    // Re-check after the async suspension — the user may have scrolled up
    // while we were waiting for nextTick, and onUserScroll sets autoScroll=false
    // synchronously.  Without this guard the watcher would still call
    // scrollToLatest("smooth"), starting a native scroll animation that fights
    // the user's intended upward scroll.
    if (!autoScroll.value) return;
    // Re-read scroll position from DOM instead of the stale autoScroll ref to
    // avoid a race where scroll restoration (post-flush) sets scrollTop near
    // the bottom after this callback was already suspended at nextTick.
    if (!scrollEl.value) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl.value;
    if (scrollHeight - scrollTop - clientHeight >= SCROLL_THRESHOLD) return;
    scrollToLatest(newLastId !== oldLastId ? "smooth" : "auto");
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
