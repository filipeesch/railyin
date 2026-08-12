<template>
  <div v-if="showPanel" class="decision-interview-panel">
    <DecisionRequest
      :questions="questions"
      :context="context"
      :answered-text="answeredText"
      @submit="onSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
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

/** Persisted terminal interview payload from conversation_messages (reconcile at turn end). */
const persistedPayload = computed<DecisionRequestPayload | null>(() => {
  const messages = conversationStore.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.conversationId !== props.conversationId) continue;
    if (m.type === "decision_request_prompt") {
      try {
        const parsed = JSON.parse(m.content) as DecisionRequestPayload;
        return Array.isArray(parsed.questions) ? parsed : { questions: [] };
      } catch {
        return { questions: [] };
      }
    }
    // Stop at the first non-interview message before it (avoid stale prompts).
    if (m.type === "assistant" || m.type === "user") break;
  }
  return null;
});

const questions = computed<DecisionRequestQuestion[]>(() => {
  const live = liveQuestions.value;
  if (live.length > 0) return live;
  return persistedPayload.value?.questions ?? [];
});

const context = computed<string | undefined>(() => persistedPayload.value?.context ?? undefined);

/** Whether the interview is still streaming (no persisted terminal yet). */
const isStreaming = computed(() => liveQuestions.value.length > 0 && persistedPayload.value === null);

/** Answered state: a user message follows the terminal prompt in history. */
const answeredText = computed<string | undefined>(() => {
  const payload = persistedPayload.value;
  if (!payload) return undefined;
  const messages = conversationStore.messages;
  let seenPrompt = false;
  for (const m of messages) {
    if (m.conversationId !== props.conversationId) continue;
    if (m.type === "decision_request_prompt") {
      seenPrompt = true;
      continue;
    }
    if (seenPrompt && m.type === "user") return m.content;
  }
  return undefined;
});

const showPanel = computed(() => {
  if (props.conversationId !== conversationStore.activeConversationId) return false;
  return questions.value.length > 0;
});

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
</style>
