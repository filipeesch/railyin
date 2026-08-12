<template>
  <div v-if="showPanel" class="decision-interview-panel">
    <div class="decision-interview-panel__header">
      <span class="decision-interview-panel__title">Questions from the agent</span>
      <button class="decision-interview-panel__dismiss" title="Dismiss" @click="dismiss">✕</button>
    </div>
    <DecisionRequest
      :questions="questions"
      :context="context"
      :answered-text="answeredText"
      @submit="onSubmit"
    />
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

/** Local "dismissed" state so the user can close the panel without answering. */
const dismissed = ref(false);
const activeConversationId = computed(() => conversationStore.activeConversationId);

// Reset the dismissed flag when switching conversations.
watch(activeConversationId, () => { dismissed.value = false; });

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
</script>

<style scoped>
.decision-interview-panel {
  padding: 4px 0 8px;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  margin-bottom: 8px;
}

.decision-interview-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.decision-interview-panel__title {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-surface-400, #94a3b8);
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
