<template>
  <!-- Resize handle sits outside the Drawer so it can overlap its left edge -->
  <div
    v-if="open"
    class="drawer-resize-handle"
    :style="{ right: drawerWidth + 'px' }"
    @mousedown.stop.prevent="startResize"
    @click.stop
  />
  <Drawer
    v-model:visible="open"
    position="right"
    :style="{ width: drawerWidth + 'px' }"
    :modal="false"
    @hide="taskStore.closeTask()"
  >
    <template #header>
      <div class="drawer-header" v-if="task">
        <span class="drawer-header__title">{{ task.title }}</span>
        <Tag
          :value="execLabel"
          :severity="execSeverity"
          rounded
          class="ml-2"
        />
      </div>
    </template>

    <div v-if="task" class="task-detail">
      <!-- Two-column layout: conversation + side panel -->
      <div class="task-detail__body">

        <!-- Conversation timeline -->
        <div class="task-detail__conversation" ref="scrollEl" @scroll.passive="onScroll">
          <div class="conversation-inner">
            <MessageBubble
              v-for="msg in taskStore.messages"
              :key="msg.id"
              :chunk="msg"
            />

            <!-- Live streaming bubble (only when this task is the one streaming) -->
            <div
              v-if="taskStore.streamingToken && taskStore.streamingTaskId === task.id"
              class="msg msg--assistant"
            >
              <div class="msg__bubble prose streaming" v-html="renderMd(taskStore.streamingToken)" />
              <div class="msg__meta">AI<span class="cursor">▌</span></div>
            </div>

            <!-- Running spinner when no tokens yet -->
            <div
              v-else-if="task.executionState === 'running'"
              class="msg msg--system"
            >
              <ProgressSpinner style="width: 20px; height: 20px" />
              <span>Thinking…</span>
            </div>

            <!-- Context warning -->
            <div v-if="contextWarning" class="context-warning">
              <i class="pi pi-exclamation-triangle" />
              {{ contextWarning }}
            </div>
          </div>
        </div>

        <!-- Side panel (9.6) -->
        <div class="task-detail__side">
          <div class="side-section">
            <div class="side-label">Workflow state</div>
            <div class="side-value">{{ task.workflowState }}</div>
          </div>
          <div class="side-section">
            <div class="side-label">Execution</div>
            <div class="side-value">{{ task.executionState }}</div>
          </div>
          <div class="side-section" v-if="task.retryCount > 0">
            <div class="side-label">Retries</div>
            <div class="side-value">{{ task.retryCount }}</div>
          </div>

          <!-- Transition buttons -->
          <div class="side-section" v-if="columns.length">
            <div class="side-label">Move to</div>
            <div class="side-transitions">
              <Button
                v-for="col in otherColumns"
                :key="col.id"
                :label="col.label"
                size="small"
                severity="secondary"
                :disabled="transitioning"
                @click="transition(col.id)"
              />
            </div>
          </div>

          <!-- Retry button (9.5) -->
          <div
            class="side-section"
            v-if="task.executionState === 'failed' || task.executionState === 'waiting_user'"
          >
            <Button
              label="Retry"
              icon="pi pi-replay"
              severity="warn"
              :loading="retrying"
              @click="retry"
            />
          </div>
        </div>
      </div>

      <!-- Chat input (9.4) -->
      <div class="task-detail__input">
        <Textarea
          v-model="inputText"
          placeholder="Send a message… (Shift+Enter for newline)"
          class="flex-1"
          rows="1"
          autoResize
          :disabled="task.executionState === 'running'"
          @keydown.enter.exact.prevent="send"
        />
        <Button
          icon="pi pi-send"
          :disabled="!inputText.trim() || task.executionState === 'running'"
          @click="send"
        />
      </div>
    </div>
  </Drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { marked } from "marked";
import Drawer from "primevue/drawer";
import Tag from "primevue/tag";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import ProgressSpinner from "primevue/progressspinner";
import MessageBubble from "./MessageBubble.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";
import type { ExecutionState } from "@shared/rpc-types";

const taskStore = useTaskStore();
const boardStore = useBoardStore();

// ─── Resizable drawer ────────────────────────────────────────────────────────
const drawerWidth = ref(860);
const MIN_WIDTH = 480;
const MAX_WIDTH = 1400;

function startResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = drawerWidth.value;

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    drawerWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
  }
  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function renderMd(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

const open = computed({
  get: () => taskStore.activeTaskId !== null,
  set: (v) => { if (!v) taskStore.closeTask(); },
});

const task = computed(() => taskStore.activeTask);
const inputText = ref("");
const transitioning = ref(false);
const retrying = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
const contextWarning = ref<string | null>(null);

// Columns from the active board template
const columns = computed(() => {
  return boardStore.activeBoard?.template.columns ?? [];
});

const otherColumns = computed(() => {
  if (!task.value) return columns.value;
  return columns.value.filter((c) => c.id !== task.value!.workflowState);
});

// ─── Smart auto-scroll ───────────────────────────────────────────────────────
// Auto-scroll is active by default. It pauses when the user scrolls up and
// resumes automatically once they scroll back within 60px of the bottom.
const SCROLL_THRESHOLD = 60; // px from bottom considered "at bottom"
const autoScroll = ref(true);

function onScroll() {
  if (!scrollEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = scrollEl.value;
  const distFromBottom = scrollHeight - scrollTop - clientHeight;
  autoScroll.value = distFromBottom < SCROLL_THRESHOLD;
}

function scrollToBottom() {
  if (!scrollEl.value) return;
  scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

// Auto-scroll to bottom when messages change
watch(
  [() => taskStore.messages.length, () => taskStore.streamingToken],
  async () => {
    await nextTick();
    if (autoScroll.value) scrollToBottom();
  },
);

// Always scroll to bottom when a new task is opened
watch(
  () => taskStore.activeTaskId,
  async () => {
    autoScroll.value = true;
    await nextTick();
    scrollToBottom();
  },
);

const execLabel = computed(() => {
  const map: Record<string, string> = {
    idle: "Idle",
    running: "Running…",
    waiting_user: "Awaiting input",
    waiting_external: "Waiting",
    failed: "Failed",
    completed: "Done",
  };
  return task.value ? (map[task.value.executionState] ?? task.value.executionState) : "";
});

const execSeverity = computed(() => {
  const map: Record<string, "secondary" | "info" | "warn" | "danger" | "success"> = {
    idle: "secondary",
    running: "info",
    waiting_user: "warn",
    waiting_external: "warn",
    failed: "danger",
    completed: "success",
  };
  return task.value ? (map[task.value.executionState] ?? "secondary") : "secondary";
});

async function send() {
  if (!inputText.value.trim() || !task.value) return;
  const content = inputText.value.trim();
  inputText.value = "";
  await taskStore.sendMessage(task.value.id, content);
}

async function transition(toState: string) {
  if (!task.value) return;
  transitioning.value = true;
  try {
    await taskStore.transitionTask(task.value.id, toState);
  } finally {
    transitioning.value = false;
  }
}

async function retry() {
  if (!task.value) return;
  retrying.value = true;
  try {
    await taskStore.retryTask(task.value.id);
  } finally {
    retrying.value = false;
  }
}
</script>

<style scoped>
.drawer-resize-handle {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1001; /* above the drawer overlay */
  background: transparent;
  transition: background 0.15s;
}

.drawer-resize-handle:hover,
.drawer-resize-handle:active {
  background: var(--p-primary-color, #6366f1);
  opacity: 0.35;
}

.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.drawer-header__title {
  font-weight: 600;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.task-detail__body {
  display: flex;
  flex: 1;
  gap: 16px;
  overflow: hidden;
}

.task-detail__conversation {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px 8px 0;
}

.conversation-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-detail__side {
  width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
  border-left: 1px solid var(--p-surface-200, #e2e8f0);
  padding-left: 16px;
}

.side-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.side-value {
  font-size: 0.85rem;
  color: var(--p-text-color, #1e293b);
}

.side-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.side-transitions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-detail__input {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.task-detail__input .flex-1 {
  flex: 1;
  resize: none;
}

.context-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--p-orange-600, #e07010);
  background: var(--p-orange-50, #fff7ed);
  border: 1px solid var(--p-orange-200, #fed7aa);
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 4px;
}

/* Streaming cursor animation */
.cursor {
  animation: blink 0.8s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.msg {
  display: flex;
  flex-direction: column;
}

.msg--assistant {
  align-items: flex-start;
}

.msg--assistant .msg__bubble {
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 12px 12px 12px 2px;
  padding: 10px 14px;
  max-width: 85%;
  word-break: break-word;
}

/* Prose styles for the live streaming bubble (v-html rendered markdown) */
.msg--assistant .msg__bubble :deep(p) { margin: 0 0 0.6em; line-height: 1.6; }
.msg--assistant .msg__bubble :deep(p:last-child) { margin-bottom: 0; }
.msg--assistant .msg__bubble :deep(h1),.msg--assistant .msg__bubble :deep(h2),
.msg--assistant .msg__bubble :deep(h3),.msg--assistant .msg__bubble :deep(h4) {
  font-weight: 600; margin: 0.8em 0 0.3em; line-height: 1.3;
}
.msg--assistant .msg__bubble :deep(ul),.msg--assistant .msg__bubble :deep(ol) {
  margin: 0.4em 0 0.6em 1.4em; padding: 0;
}
.msg--assistant .msg__bubble :deep(li) { margin: 0.15em 0; line-height: 1.5; }
.msg--assistant .msg__bubble :deep(code) {
  font-family: ui-monospace, monospace; font-size: 0.82em;
  background: var(--p-surface-100, #f1f5f9); border-radius: 4px; padding: 1px 5px;
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

.msg--system {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
  padding: 4px 0;
}
</style>
