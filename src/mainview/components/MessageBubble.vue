<template>
  <div v-if="chunk.type === 'user'" class="msg msg--user">
    <div class="msg__bubble">{{ chunk.content }}</div>
    <div class="msg__meta">You</div>
  </div>

  <div v-else-if="chunk.type === 'assistant'" class="msg msg--assistant">
    <div class="msg__bubble prose" v-html="renderMd(chunk.content)" />
    <div class="msg__meta">AI</div>
  </div>

  <div v-else-if="chunk.type === 'system'" class="msg msg--system">
    <i class="pi pi-info-circle" />
    <span>{{ chunk.content }}</span>
  </div>

  <div v-else-if="chunk.type === 'transition_event'" class="msg msg--transition">
    <i class="pi pi-arrow-right" />
    <span>
      Moved to <strong>{{ meta?.to ?? "?" }}</strong>
      <template v-if="meta?.from"> from {{ meta.from }}</template>
    </span>
  </div>

  <div v-else-if="chunk.type === 'tool_call'" class="msg msg--tool">
    <i class="pi pi-code" />
    <span class="msg__tool-name">{{ toolName }}</span>
    <pre class="msg__tool-body">{{ chunk.content }}</pre>
  </div>

  <div v-else-if="chunk.type === 'tool_result'" class="msg msg--tool-result">
    <i class="pi pi-check-square" />
    <pre class="msg__tool-body">{{ truncated }}</pre>
  </div>

  <div v-else-if="chunk.type === 'artifact_event'" class="msg msg--artifact">
    <i class="pi pi-file" />
    <span>{{ chunk.content }}</span>
  </div>

  <div v-else-if="chunk.type === 'ask_user_prompt'" class="msg msg--ask-prompt">
    <AskUserPrompt
      :question="askPayload.question"
      :selection-mode="askPayload.selection_mode"
      :options="askPayload.options"
      :answered-text="answeredText"
      @submit="onAskSubmit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import type { ConversationMessage } from "@shared/rpc-types";
import AskUserPrompt from "./AskUserPrompt.vue";
import { useTaskStore } from "../stores/task";

const props = defineProps<{
  chunk: ConversationMessage;
  /** Index of this message in the full list — used to detect if ask_user_prompt was answered */
  index?: number;
}>();

const emit = defineEmits<{
  sendMessage: [content: string];
}>();

const taskStore = useTaskStore();

function renderMd(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

const meta = computed(() => props.chunk.metadata as Record<string, string> | null);

const toolName = computed(() => {
  try {
    const parsed = JSON.parse(props.chunk.content);
    return parsed?.function?.name ?? parsed?.name ?? "tool";
  } catch {
    return "tool";
  }
});

const truncated = computed(() => {
  const c = props.chunk.content;
  return c.length > 800 ? c.slice(0, 800) + "\n…[truncated]" : c;
});

// ─── ask_user_prompt support ──────────────────────────────────────────────────

const askPayload = computed(() => {
  if (props.chunk.type !== "ask_user_prompt") {
    return { question: "", selection_mode: "single" as const, options: [] as string[] };
  }
  try {
    const p = JSON.parse(props.chunk.content) as { question: string; selection_mode: "single" | "multi"; options: string[] };
    return p;
  } catch {
    return { question: props.chunk.content, selection_mode: "single" as const, options: [] as string[] };
  }
});

/** The answer text if a user message follows this prompt in conversation history. */
const answeredText = computed(() => {
  if (props.chunk.type !== "ask_user_prompt" || props.index === undefined) return undefined;
  const messages = taskStore.messages;
  const later = messages.slice(props.index + 1);
  const reply = later.find((m) => m.type === "user");
  return reply?.content;
});

async function onAskSubmit(answer: string) {
  const taskId = taskStore.activeTaskId;
  if (taskId === null) return;
  await taskStore.sendMessage(taskId, answer);
}
</script>

<style scoped>
.msg {
  display: flex;
  flex-direction: column;
  margin: 4px 0;
}

.msg--user {
  align-items: flex-end;
}

.msg--user .msg__bubble {
  background: var(--p-primary-100, #e0e7ff);
  color: var(--p-primary-900, #1e1b4b);
  border-radius: 12px 12px 2px 12px;
  padding: 10px 14px;
  max-width: 80%;
  white-space: pre-wrap;
  word-break: break-word;
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

/* ── Prose styles for rendered markdown ─────────────────────────────────── */
.prose :deep(p) {
  margin: 0 0 0.6em;
  line-height: 1.6;
}
.prose :deep(p:last-child) { margin-bottom: 0; }

.prose :deep(h1),
.prose :deep(h2),
.prose :deep(h3),
.prose :deep(h4) {
  font-weight: 600;
  margin: 0.8em 0 0.3em;
  line-height: 1.3;
}
.prose :deep(h1) { font-size: 1.1rem; }
.prose :deep(h2) { font-size: 1rem; }
.prose :deep(h3) { font-size: 0.9rem; }

.prose :deep(ul),
.prose :deep(ol) {
  margin: 0.4em 0 0.6em 1.4em;
  padding: 0;
}
.prose :deep(li) { margin: 0.15em 0; line-height: 1.5; }

.prose :deep(code) {
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 0.82em;
  background: var(--p-surface-100, #f1f5f9);
  border-radius: 4px;
  padding: 1px 5px;
}

.prose :deep(pre) {
  background: var(--p-surface-900, #0f172a);
  color: var(--p-surface-100, #f1f5f9);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.8rem;
  line-height: 1.5;
}
.prose :deep(pre code) {
  background: none;
  padding: 0;
  font-size: inherit;
  color: inherit;
}

.prose :deep(blockquote) {
  border-left: 3px solid var(--p-surface-300, #cbd5e1);
  margin: 0.5em 0;
  padding: 2px 0 2px 12px;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}

.prose :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.6em 0;
  font-size: 0.82rem;
}
.prose :deep(th),
.prose :deep(td) {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 5px 10px;
  text-align: left;
}
.prose :deep(th) {
  background: var(--p-surface-50, #f8fafc);
  font-weight: 600;
}

.prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  margin: 0.8em 0;
}

.prose :deep(a) {
  color: var(--p-primary-color, #6366f1);
  text-decoration: underline;
}

.msg__meta {
  font-size: 0.7rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-top: 2px;
  padding: 0 4px;
}

.msg--system,
.msg--transition,
.msg--artifact {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
  padding: 4px 0;
}

.msg--tool,
.msg--tool-result {
  flex-direction: column;
  gap: 4px;
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.8rem;
}

.msg--tool {
  align-items: flex-start;
}

.msg__tool-name {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--p-primary-color, #6366f1);
}

.msg__tool-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 0.75rem;
  color: var(--p-text-color, #334155);
  max-height: 200px;
  overflow-y: auto;
}

.msg--ask-prompt {
  align-items: flex-start;
  max-width: 100%;
}
</style>
