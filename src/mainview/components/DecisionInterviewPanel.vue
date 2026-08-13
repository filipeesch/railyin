<template>
  <div v-if="showPanel" class="decision-interview-panel" :class="{ 'decision-interview-panel--resizing': resizing }" :style="{ '--panel-height': panelHeight + 'px' }">
    <!-- Resize handle: drag to adjust the panel height (see chat above / enlarge) -->
    <div
      class="decision-interview-panel__resize"
      title="Drag to resize"
      @mousedown="onResizeStart"
      @dblclick="resetHeight"
    >
      <span class="decision-interview-panel__resize-grip" aria-hidden="true">⠿</span>
    </div>
    <div class="decision-interview-panel__header">
      <div class="decision-interview-panel__heading">
        <span class="decision-interview-panel__icon" aria-hidden="true">💬</span>
        <span class="decision-interview-panel__title">Questions from the agent</span>
      </div>
      <button class="decision-interview-panel__dismiss" title="Dismiss" aria-label="Dismiss" @click="dismiss">✕</button>
    </div>
    <div class="decision-interview-panel__body">
      <DecisionRequest
        :questions="questions"
        :context="context"
        :answered-text="answeredText"
        @submit="onSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DecisionRequestPayload, DecisionRequestQuestion } from "@shared/rpc-types";
import DecisionRequest from "./DecisionRequest.vue";
import { useConversationStore } from "../stores/conversation";
import { useChatStore } from "../stores/chat";
import { useTaskStore } from "../stores/task";

const props = defineProps<{
  conversationId: number;
  taskId?: number | null;
  chatSessionId?: number | null;
}>();

const conversationStore = useConversationStore();
const chatStore = useChatStore();
const taskStore = useTaskStore();

/**
 * Live questions from streaming decision_request_page events while the model is
 * still running. Once the terminal decision_request_prompt is persisted, the
 * panel falls back to rendering the persisted payload (reconcile).
 */
const liveQuestions = computed<DecisionRequestQuestion[]>(() => {
  if (props.conversationId !== conversationStore.activeConversationId) return [];
  return conversationStore.liveInterviews.get(props.conversationId) ?? [];
});

/**
 * The latest persisted `decision_request_prompt` message for this conversation
 * (if any). Used to render the terminal interview after the model ends its
 * turn, and to detect whether the interview has already been answered.
 */
const latestPromptIndex = computed<number>(() => {
  const messages = conversationStore.messages;
  let found = -1;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.conversationId !== props.conversationId) continue;
    if (m.type === "decision_request_prompt") found = i;
  }
  return found;
});

const persistedPayload = computed<DecisionRequestPayload | null>(() => {
  const idx = latestPromptIndex.value;
  if (idx < 0) return null;
  const raw = conversationStore.messages[idx].content;
  try {
    const parsed = JSON.parse(raw) as DecisionRequestPayload;
    return Array.isArray(parsed.questions) ? parsed : { questions: [] };
  } catch {
    return { questions: [] };
  }
});

const questions = computed<DecisionRequestQuestion[]>(() => {
  const live = liveQuestions.value;
  if (live.length > 0) return live;
  return persistedPayload.value?.questions ?? [];
});

const context = computed<string | undefined>(() => persistedPayload.value?.context ?? undefined);

/**
 * Answered state: a user message appears AFTER the latest terminal prompt.
 * When set, the panel closes (the interview has been answered or dismissed by
 * submitting).
 */
const answeredText = computed<string | undefined>(() => {
  const idx = latestPromptIndex.value;
  if (idx < 0) return undefined;
  const messages = conversationStore.messages;
  for (let i = idx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.conversationId !== props.conversationId) continue;
    if (m.type === "user") return m.content;
  }
  return undefined;
});

/**
 * Dismissal is scoped to the CURRENT interview episode, not the conversation:
 * `dismissed` resets automatically when a NEW interview episode begins (a new
 * `decision_request_page` event arrives from a different execution after
 * dismissal), so the panel can spawn again for later questions.
 */
const dismissed = ref(false);
const dismissedForExecution = ref<number | null>(null);
const activeConversationId = computed(() => conversationStore.activeConversationId);

const liveExecutionId = computed<number | null>(() =>
  props.conversationId === conversationStore.activeConversationId
    ? conversationStore.liveInterviewExecutions.get(props.conversationId) ?? null
    : null,
);

// Reset the dismissed flag when switching conversations.
watch(activeConversationId, () => {
  dismissed.value = false;
  dismissedForExecution.value = null;
});

// A new execution streaming pages after dismissal = a new interview episode:
// reset the dismissed flag so the panel can spawn again.
watch(liveExecutionId, (executionId) => {
  if (dismissed.value && executionId !== null && executionId !== dismissedForExecution.value) {
    dismissed.value = false;
    dismissedForExecution.value = null;
  }
});

const showPanel = computed(() => {
  if (props.conversationId !== conversationStore.activeConversationId) return false;
  if (dismissed.value) return false;
  // Hide once the interview has been answered (a user message follows the
  // latest terminal prompt) so the panel closes after submission.
  if (answeredText.value !== undefined) return false;
  return questions.value.length > 0;
});

function dismiss() {
  dismissed.value = true;
  dismissedForExecution.value = liveExecutionId.value;
}

async function onSubmit(payload: {
  text: string;
  decisions: Array<{ question: string; answer: string; weight: string; notes?: string }>;
  generalNotes?: string;
  recordAsDecisions?: boolean;
}) {
  const { decisions, generalNotes, recordAsDecisions } = payload;
  const answers = decisions.map((d) => ({ question: d.question, answer: d.answer, weight: d.weight, notes: d.notes }));
  if (props.taskId != null) {
    await taskStore.submitDecisions(props.taskId, answers, generalNotes, recordAsDecisions);
    return;
  }
  if (props.chatSessionId != null) {
    await chatStore.submitDecisions(props.chatSessionId, answers, generalNotes, recordAsDecisions);
  }
}

/**
 * Panel height in px, adjustable via the resize handle on top of the panel.
 * Defaults to a comfortable expanded height; capped by the viewport so the
 * chat above stays visible. Resetting (double-click) restores the default.
 */
const DEFAULT_PANEL_HEIGHT = 320;
const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT_RATIO = 0.7; // never exceed 70% of the viewport

const panelHeight = ref(DEFAULT_PANEL_HEIGHT);
const resizing = ref(false);

function onResizeStart(event: MouseEvent) {
  event.preventDefault();
  resizing.value = true;
  const startY = event.clientY;
  const startHeight = panelHeight.value;

  const onMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientY - startY;
    // Dragging DOWN increases height (grip is at the top; chat sits above).
    const next = Math.min(
      Math.max(startHeight + delta, MIN_PANEL_HEIGHT),
      Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_RATIO),
    );
    panelHeight.value = next;
  };

  const onUp = () => {
    resizing.value = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
}

function resetHeight() {
  panelHeight.value = DEFAULT_PANEL_HEIGHT;
}
</script>

<style scoped>
.decision-interview-panel {
  margin: 5px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
}

/* Resize handle — drag to enlarge/shrink the panel (grip on top edge) */
.decision-interview-panel__resize {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 12px;
  cursor: row-resize;
  user-select: none;
  border-radius: 4px 4px 0 0;
}

.decision-interview-panel__resize:hover {
  background: var(--p-surface-200, #e2e8f0);
}

.decision-interview-panel__resize-grip {
  font-size: 0.8rem;
  color: var(--p-surface-400, #94a3b8);
  line-height: 1;
  pointer-events: none;
}

/* Scrollable body: keeps the footer buttons reachable when the interview is
   taller than the panel / viewport. */
.decision-interview-panel__body {
  height: var(--panel-height);
  min-height: 120px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.decision-interview-panel--resizing {
  cursor: row-resize;
}

.decision-interview-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 6px;
  background: var(--p-surface-100, #f1f5f9);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 6px;
}

.decision-interview-panel__heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.decision-interview-panel__icon {
  font-size: 0.85rem;
  line-height: 1;
  flex-shrink: 0;
}

.decision-interview-panel__title {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-surface-600, #475569);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.decision-interview-panel__dismiss {
  border: none;
  background: transparent;
  color: var(--p-surface-400, #94a3b8);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}

.decision-interview-panel__dismiss:hover {
  background: var(--p-surface-200, #e2e8f0);
  color: var(--p-surface-700, #334155);
}
</style>

<style>
html.dark-mode .decision-interview-panel__header {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-600, #475569);
}

html.dark-mode .decision-interview-panel__title {
  color: var(--p-surface-300, #cbd5e1);
}

html.dark-mode .decision-interview-panel__dismiss {
  color: var(--p-surface-400, #94a3b8);
}

html.dark-mode .decision-interview-panel__dismiss:hover {
  background: var(--p-surface-700, #334155);
  color: var(--p-surface-200, #e2e8f0);
}

html.dark-mode .decision-interview-panel__resize:hover {
  background: var(--p-surface-800, #1e293b);
}

html.dark-mode .decision-interview-panel__resize-grip {
  color: var(--p-surface-500, #64748b);
}
</style>
