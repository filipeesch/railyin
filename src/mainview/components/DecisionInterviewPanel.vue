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
        :ready-to-submit="readyToSubmit"
        @submit="onSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { DecisionRequestPayload, DecisionRequestQuestion } from "@shared/rpc-types";
import DecisionRequest from "./DecisionRequest.vue";
import {
  computeResizeHeight,
  episodeKey,
  hasUserMessageAfterPrompt,
  isDismissedEpisode,
  isInterviewStale,
  latestPromptId,
} from "../utils/decisionInterview";
import { useConversationStore } from "../stores/conversation";
import { useChatStore } from "../stores/chat";
import { useTaskStore } from "../stores/task";

const props = defineProps<{
  conversationId: number;
  taskId?: number | null;
  chatSessionId?: number | null;
  /** Task/session execution state — gates Submit on `waiting_user` (D2). */
  executionState?: string | null;
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
 * The latest persisted `decision_request_prompt` message id for this
 * conversation (if any). Used to render the terminal interview after the model
 * ends its turn, and to detect whether the interview has already been answered.
 */
const latestPromptIdValue = computed<number | null>(() =>
  latestPromptId(conversationStore.messages, props.conversationId),
);

const persistedPayload = computed<DecisionRequestPayload | null>(() => {
  const promptId = latestPromptIdValue.value;
  if (promptId == null) return null;
  const promptMessage = conversationStore.messages.find(
    (m) => m.id === promptId && m.conversationId === props.conversationId,
  );
  if (!promptMessage) return null;
  try {
    const parsed = JSON.parse(promptMessage.content) as DecisionRequestPayload;
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

const hasLivePages = computed(() => liveQuestions.value.length > 0);

/**
 * Robust answered detection (D3): the interview is answered when a user message
 * exists with an id AFTER the latest terminal prompt (id-based), OR when the
 * conversation has clearly moved past a persisted interview (stale — execution
 * no longer awaiting input and no live pages streaming). The stale rule covers
 * the early-submit race where the answer message predates the terminal prompt,
 * plus reloads and dropped websocket pushes.
 */
const answered = computed<boolean>(() => {
  const promptId = latestPromptIdValue.value;
  if (promptId != null && hasUserMessageAfterPrompt(conversationStore.messages, props.conversationId, promptId)) {
    return true;
  }
  return isInterviewStale(props.executionState ?? null, hasLivePages.value, latestPromptIdValue.value != null);
});

/**
 * Submit is only allowed once the conversation is awaiting the answers — the
 * terminal `decision_request_prompt` has been persisted and the task/session is
 * `waiting_user`. This closes the early-submit ordering race (D2).
 */
const readyToSubmit = computed(() => props.executionState === "waiting_user");

const liveExecutionId = computed<number | null>(() =>
  props.conversationId === conversationStore.activeConversationId
    ? conversationStore.liveInterviewExecutions.get(props.conversationId) ?? null
    : null,
);

/** Stable key identifying the current interview episode (live execution wins). */
const currentEpisodeKey = computed<string | null>(() =>
  episodeKey(liveExecutionId.value, latestPromptIdValue.value),
);

/**
 * True when the current interview episode has been dismissed. Backed by the
 * conversation store (D4) so dismissal persists across drawer reopen/remount; a
 * NEW episode (different execution or prompt id) naturally mismatches the stored
 * key and lets the panel spawn again.
 */
const dismissed = computed<boolean>(() =>
  isDismissedEpisode(
    conversationStore.dismissedInterviews.get(props.conversationId) ?? null,
    currentEpisodeKey.value,
  ),
);

const showPanel = computed(() => {
  if (props.conversationId !== conversationStore.activeConversationId) return false;
  if (dismissed.value) return false;
  // Hide once the interview has been answered or the conversation has moved
  // past it (robust detection — D3).
  if (answered.value) return false;
  return questions.value.length > 0;
});

function dismiss() {
  const key = currentEpisodeKey.value;
  if (key != null) conversationStore.dismissInterview(props.conversationId, key);
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
    // The grip sits on the panel's TOP edge and the bottom is fixed in the
    // drawer flow: dragging UP grows the panel, dragging DOWN shrinks it.
    panelHeight.value = computeResizeHeight(
      startHeight,
      delta,
      MIN_PANEL_HEIGHT,
      Math.floor(window.innerHeight * MAX_PANEL_HEIGHT_RATIO),
    );
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

/* Body hosts the DecisionRequest card, which owns the scroll (D6): the
   question content scrolls inside `.interview__content`, the footer stays
   fixed. The body itself must not scroll. */
.decision-interview-panel__body {
  height: var(--panel-height);
  min-height: 120px;
  overflow: hidden;
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
