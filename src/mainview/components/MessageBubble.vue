<template>
  <div v-if="chunk.type === 'user' && chunk.role === 'prompt'" class="msg msg--prompt">
    <i class="pi pi-bolt" />
    <code class="msg--prompt__label">{{ displayContent }}</code>
  </div>

  <div v-else-if="chunk.type === 'user'" class="msg msg--user">
    <div class="msg__bubble">{{ displayContent }}</div>
    <div v-if="userAttachments.length > 0" class="msg__attachments">
      <span v-for="(att, idx) in userAttachments" :key="idx" class="msg__attachment-chip">
        📎 {{ att.label }}
      </span>
    </div>
    <div class="msg__meta">You</div>
  </div>

  <div v-else-if="chunk.type === 'assistant' && !isXmlToolCall && chunk.content.trim()" class="msg msg--assistant">
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

  <div v-else-if="chunk.type === 'ask_user_prompt'" class="msg msg--ask-prompt">
    <ShellApprovalPrompt
      v-if="shellApprovalPayload"
      :command="shellApprovalPayload.command"
      :unapproved-binaries="shellApprovalPayload.unapprovedBinaries"
      :answered="answeredText"
      @respond="onShellApprovalRespond"
    />
    <AskUserPrompt
      v-else
      :questions="askPayload.questions"
      :answered-text="answeredText"
      @submit="onAskSubmit"
    />
  </div>

  <div v-else-if="chunk.type === 'interview_prompt'" class="msg msg--interview-prompt">
    <InterviewMe
      :questions="interviewPayload.questions"
      :context="interviewPayload.context"
      :answered-text="interviewAnsweredText"
      @submit="onInterviewSubmit"
    />
  </div>

  <!-- Persisted reasoning messages from DB (collapsed, non-streaming) -->
  <ReasoningBubble
    v-else-if="chunk.type === 'reasoning'"
    :content="chunk.content"
    :streaming="false"
  />

  <!-- Conversation compaction marker -->
  <div v-else-if="chunk.type === 'compaction_summary'" class="msg msg--compaction">
    <div class="msg--compaction__divider">
      <span class="msg--compaction__label">— Conversation compacted —</span>
    </div>
    <details class="msg--compaction__details">
      <summary>Show summary</summary>
      <div class="msg--compaction__summary prose" v-html="renderMd(chunk.content)" />
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { marked } from "marked";
import type { ConversationMessage, AskUserPromptContent, InterviewPayload } from "@shared/rpc-types";
import AskUserPrompt from "./AskUserPrompt.vue";
import InterviewMe from "./InterviewMe.vue";
import ReasoningBubble from "./ReasoningBubble.vue";
import ShellApprovalPrompt from "./ShellApprovalPrompt.vue";
import { useTaskStore } from "../stores/task";
import { api } from "../rpc";

const props = defineProps<{
  chunk: ConversationMessage;
  /** Index of this message in the full list — used to detect if ask_user_prompt was answered */
  index?: number;
}>();

const taskStore = useTaskStore();

function renderMd(content: string): string {
  return marked.parse(content, { async: false, breaks: true, gfm: true }) as string;
}

const displayContent = computed(() => props.chunk.content);

const userAttachments = computed<Array<{ label: string }>>(() => {
  if (props.chunk.type !== "user" || !props.chunk.metadata) return [];
  const meta = props.chunk.metadata as Record<string, unknown>;
  if (!Array.isArray(meta.attachments)) return [];
  return meta.attachments as Array<{ label: string }>;
});

/** True when an assistant message was generated in XML <tool_call> format instead of the JSON API format. These should be silently hidden. */
const isXmlToolCall = computed(() =>
  props.chunk.type === "assistant" && props.chunk.content.trimStart().startsWith("<tool_call>"),
);


// ─── ask_user_prompt support ──────────────────────────────────────────────────

/** Normalize stored ask_user_prompt content to the canonical AskUserPromptContent shape.
 * Handles both the legacy { question, selection_mode, options: string[] } format
 * and the new { questions: [...] } format so old messages continue to render. */
function parseAskPayload(content: string): AskUserPromptContent {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    if (Array.isArray(raw.questions)) {
      // New format — ensure options are objects with at least a label
      return {
        questions: (raw.questions as Array<Record<string, unknown>>).map((q) => ({
          question: String(q.question ?? ""),
          selection_mode: (q.selection_mode as "single" | "multi") ?? "single",
          options: (Array.isArray(q.options) ? q.options : []).map((o: unknown) =>
            typeof o === "string" ? { label: o } : (o as { label: string }),
          ),
        })),
      };
    }
    // Legacy format: top-level question + options: string[]
    const legacyOptions: string[] = Array.isArray(raw.options) ? raw.options as string[] : [];
    return {
      questions: [{
        question: String(raw.question ?? content),
        selection_mode: (raw.selection_mode as "single" | "multi") ?? "single",
        options: legacyOptions.map((o) => ({ label: o })),
      }],
    };
  } catch {
    return { questions: [{ question: content, selection_mode: "single", options: [] }] };
  }
}

const askPayload = computed<AskUserPromptContent>(() => {
  if (props.chunk.type !== "ask_user_prompt") {
    return { questions: [] };
  }
  return parseAskPayload(props.chunk.content);
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

// ─── Shell approval support ───────────────────────────────────────────────────

type ShellApprovalPayload = { subtype: "shell_approval"; command: string; unapprovedBinaries: string[] };

const shellApprovalPayload = computed<ShellApprovalPayload | null>(() => {
  if (props.chunk.type !== "ask_user_prompt") return null;
  try {
    const raw = JSON.parse(props.chunk.content) as Record<string, unknown>;
    if (raw.subtype === "shell_approval") {
      return {
        subtype: "shell_approval",
        command: String(raw.command ?? ""),
        unapprovedBinaries: Array.isArray(raw.unapprovedBinaries) ? raw.unapprovedBinaries as string[] : [],
      };
    }
  } catch { /* not a shell_approval message */ }
  return null;
});

async function onShellApprovalRespond(decision: "approve_once" | "approve_all" | "deny") {
  const taskId = taskStore.activeTaskId;
  if (taskId === null) return;
  await api("tasks.respondShellApproval", { taskId, decision });
}

// ─── interview_prompt support ─────────────────────────────────────────────────

const interviewPayload = computed<InterviewPayload>(() => {
  if (props.chunk.type !== "interview_prompt") return { questions: [] };
  try {
    const parsed = JSON.parse(props.chunk.content) as InterviewPayload;
    return Array.isArray(parsed.questions) ? parsed : { ...parsed, questions: [] };
  } catch {
    return { questions: [] };
  }
});

const interviewAnsweredText = computed(() => {
  if (props.chunk.type !== "interview_prompt" || props.index === undefined) return undefined;
  const messages = taskStore.messages;
  const later = messages.slice(props.index + 1);
  const reply = later.find((m) => m.type === "user");
  return reply?.content;
});

async function onInterviewSubmit(answer: string) {
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
  font-size: 0.92rem;
}

.msg__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.msg__attachment-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: rgba(0,0,0,0.06);
  border-radius: 8px;
  font-size: 11px;
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
  font-size: 0.92rem;
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
  background: var(--p-content-hover-background);
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
  border-left: 3px solid var(--p-content-border-color);
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
  border: 1px solid var(--p-content-border-color);
  padding: 5px 10px;
  text-align: left;
}
.prose :deep(th) {
  background: var(--p-content-hover-background);
  font-weight: 600;
}

.prose :deep(hr) {
  border: none;
  border-top: 1px solid var(--p-content-border-color);
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
.msg--transition {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #94a3b8);
  padding: 4px 0;
}

.msg--ask-prompt {
  align-items: flex-start;
  max-width: 100%;
}

.msg--interview-prompt {
  align-items: flex-start;
  max-width: 100%;
}

.msg--prompt {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  color: var(--p-text-muted-color, #94a3b8);
}

.msg--prompt__label {
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 0.78rem;
}

.msg--compaction {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}

.msg--compaction__divider {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.75rem;
}

.msg--compaction__divider::before,
.msg--compaction__divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--p-content-border-color);
}

.msg--compaction__label {
  white-space: nowrap;
}

.msg--compaction__details summary {
  font-size: 0.75rem;
  color: var(--p-primary-color, #6366f1);
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}

.msg--compaction__summary {
  margin-top: 6px;
  padding: 8px 12px;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  font-size: 0.82rem;
}
</style>

<style>
/* Dark mode overrides for palette-based colors that don't flip via PrimeVue variables */
html.dark-mode .msg--user .msg__bubble {
  background: color-mix(in srgb, var(--p-primary-color) 25%, var(--p-content-background) 75%) !important;
  color: var(--p-text-color) !important;
}
</style>
