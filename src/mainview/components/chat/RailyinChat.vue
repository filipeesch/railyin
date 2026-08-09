<template>
  <div class="railyn-chat">
    <!-- Loading: centered ProgressSpinner until the thread connect/replay
         resolves (first MESSAGES_SNAPSHOT or connect finalize) — the legacy
         .scv-loading pattern; no welcome-screen flash (welcome-screen=false
         + explicit threadId, RESEARCH Pitfall 2). -->
    <div v-if="!connected" class="railyn-chat__loading" data-testid="chat-loading">
      <ProgressSpinner style="width: 32px; height: 32px" />
    </div>

    <!-- Error: RUN_ERROR terminal → inline error row + PrimeVue toast
         ("Execution failed: {error}", legacy onStreamError parity). -->
    <div v-else-if="runError" class="railyn-chat__error" data-testid="chat-error-row" role="alert">
      <i class="pi pi-exclamation-circle" />
      <span>Execution failed: {{ runError }}</span>
    </div>

    <!-- Empty: never-run thread (RUNR-06) — UI-SPEC copywriting contract. -->
    <div v-else-if="empty" class="railyn-chat__empty" data-testid="chat-empty-state">
      <h3 class="railyn-chat__empty-heading">No messages yet</h3>
      <p class="railyn-chat__empty-body">Send a message to start, or type / to browse commands.</p>
    </div>

    <CopilotChat
      v-show="connected"
      class="railyn-chat"
      :thread-id="threadId"
      :input-tools-menu="toolsMenu"
      :welcome-screen="false"
      @stop="onStop"
    >
      <template
        #input="{
          modelValue,
          isRunning,
          inputToolsMenu,
          onUpdateModelValue,
          onSubmitMessage,
          onStop: slotOnStop,
        }"
      >
        <div class="railyn-chat__input" data-testid="chat-input">
          <CopilotChatInput
            :model-value="modelValue"
            :is-running="isRunning"
            :tools-menu="inputToolsMenu"
            :disabled="hasInterrupt"
            placeholder="Send a message… (Shift+Enter for newline)"
            @update:model-value="onUpdateModelValue"
            @submit-message="onSubmitMessage"
            @stop="slotOnStop"
          />
          <Button
            v-if="isRunning"
            data-testid="stop-btn"
            icon="pi pi-stop"
            severity="danger"
            text
            rounded
            aria-label="Stop"
            v-tooltip="'Stop'"
            @click="onStop"
          />
        </div>
      </template>
    </CopilotChat>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useToast } from "primevue/usetoast";
import Button from "primevue/button";
import ProgressSpinner from "primevue/progressspinner";
import {
  CopilotChat,
  CopilotChatInput,
  useAgent,
  useDefaultRenderTool,
  useInterrupt,
} from "@copilotkit/vue/v2";
import type { ToolsMenuItem } from "@copilotkit/vue/v2";
import { getCommandsRef, getCommandsRefForWorkspace, toToolsMenu } from "../../composables/useCommandsCache";

/**
 * RailyinChat.vue — the SINGLE CopilotKit surface (D-01). Owns the pinned
 * CopilotChat component, every slot, the hooks (useAgent / useInterrupt /
 * useDefaultRenderTool), the stop plumbing (D-08), and all CopilotKit CSS
 * overrides in its non-scoped style block. The early-access SDK upgrade path
 * is editing this one file.
 *
 * Thread wiring (D-03, CHAT-07): the threadId prop (String(conversationId))
 * drives CopilotChat's internal connect — POST /agent/default/connect replays
 * JSONL history on mount/switch. The wrapper never reads the legacy
 * conversationStore (Pitfall 5).
 */
const props = defineProps<{
  threadId: string;
  title?: string;
  commandsScope?: { taskId?: number; workspaceKey?: string };
}>();

const toast = useToast();

// Default expandable card for all non-domain tools (D-04). Do NOT add a
// generic #tool-call slot — it would short-circuit this registry for every
// tool (RESEARCH anti-pattern).
useDefaultRenderTool();

// Publishes the pending decision interrupt into the core → #interrupt slot
// (Phase 3 contract). hasInterrupt disables the input while a decision is
// pending (CHAT-09 c3).
const { hasInterrupt } = useInterrupt();

// Same hook CopilotChat uses internally with the same args — resolves to the
// SAME per-thread agent clone (WeakMap-cached), so subscribing here observes
// the exact messages/isRunning/error state CopilotChat renders.
const { agent } = useAgent({ agentId: "default", threadId: () => props.threadId });

// ─── toolsMenu (CHAT-06, D-07) ────────────────────────────────────────────────
// Card scope → getCommandsRef(taskId); session scope → workspaceKey path.
// toToolsMenu returns [] for zero commands → the menu affordance is hidden.
const toolsMenu = computed<ToolsMenuItem[]>(() => {
  const scope = props.commandsScope;
  if (!scope) return [];
  if (scope.taskId != null) return toToolsMenu(getCommandsRef(scope.taskId).value);
  if (scope.workspaceKey) return toToolsMenu(getCommandsRefForWorkspace(scope.workspaceKey).value);
  return [];
});

// ─── Stop (D-08) ───────────────────────────────────────────────────────────────
// The wire emits aborted runs as plain RUN_FINISHED { result: null } —
// indistinguishable from a natural completion, so the "Stopped" label is
// wrapper-local state (stopRequested), never derived from wire events.
const stopRequested = ref(false);

function onStop() {
  stopRequested.value = true;
  agent.value?.abortRun();
}

// ─── Chat states (UI-SPEC chat-message-stream rows) ───────────────────────────
// connected: first MESSAGES_SNAPSHOT (replay) or connect finalize (never-run
// threads complete the connect with zero events — the core connectAgent
// resolves with defaultValue, then onRunFinalized fires). The spinner shows
// until this flips; CopilotChat stays MOUNTED the whole time (v-show) so its
// internal connectAgent keeps running (hiding it with v-if would deadlock).
const connected = ref(false);
// Message count from the same agent clone CopilotChat renders — the empty
// computed drives the never-run state (RUNR-06).
const messageCount = ref(0);
// RUN_ERROR message (RunErrorEvent.message) — inline row + toast, cleared on
// the next run (onRunInitialized).
const runError = ref<string | null>(null);

const empty = computed(() => connected.value && messageCount.value === 0);

let unsubscribe: (() => void) | null = null;
watch(
  agent,
  (a) => {
    unsubscribe?.();
    unsubscribe = null;
    if (!a) return;
    const sub = a.subscribe({
      onRunInitialized: () => {
        stopRequested.value = false;
        runError.value = null;
      },
      onRunErrorEvent: (params) => {
        connected.value = true;
        runError.value = params.event.message ?? "Run failed";
      },
      onMessagesSnapshotEvent: () => {
        connected.value = true;
      },
      onRunFinalized: () => {
        connected.value = true;
      },
      onMessagesChanged: (params) => {
        messageCount.value = params.messages.length;
      },
    });
    unsubscribe = sub.unsubscribe;
  },
  { immediate: true },
);

onUnmounted(() => unsubscribe?.());

// PrimeVue error toast mirroring the legacy onStreamError behavior
// (App.vue:54-57 — summary "Execution failed", detail = error, life 6000).
watch(runError, (err) => {
  if (err) {
    toast.add({ severity: "error", summary: "Execution failed", detail: err, life: 6000 });
  }
});
</script>

<!-- Non-scoped style block — the single home for ALL CopilotKit CSS overrides
     (D-01). No `scoped` attr: the override targets are third-party internals
     (ConversationDrawer.vue:143-177 pattern). -->
<style>
.railyn-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* The CopilotChat root (also .railyn-chat — attribute fallthrough) fills the
   wrapper; state blocks (loading/empty/error) take flow space above it. */
.railyn-chat > .railyn-chat {
  flex: 1 1 0%;
  min-height: 0;
}

/* Loading row — centered ProgressSpinner (legacy .scv-loading pattern). */
.railyn-chat__loading {
  flex: 1 1 0%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Empty row — UI-SPEC copywriting contract (never-run thread, RUNR-06). */
.railyn-chat__empty {
  flex: 1 1 0%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
  padding: 24px;
}

.railyn-chat__empty-heading {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.railyn-chat__empty-body {
  margin: 0;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

/* Error row — RUN_ERROR terminal (inline in the message area). */
.railyn-chat__error {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 8px 14px;
  border: 1px solid var(--p-red-300, #fca5a5);
  border-radius: 8px;
  background: var(--p-red-50, #fef2f2);
  color: var(--p-red-700, #b91c1c);
  font-size: 0.85rem;
}

html.dark-mode .railyn-chat__error {
  border-color: var(--p-red-800, #991b1b);
  background: var(--p-red-950, #450a0a);
  color: var(--p-red-300, #fca5a5);
}

.railyn-chat__input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 12px;
}

/* Markdown parity rules (ported from ConversationBody.vue:608-627) */
.railyn-chat p {
  margin: 0 0 0.6em;
  line-height: 1.6;
}

.railyn-chat h1,
.railyn-chat h2,
.railyn-chat h3,
.railyn-chat h4 {
  font-weight: 600;
  margin: 0.8em 0 0.3em;
  line-height: 1.3;
}

.railyn-chat ul,
.railyn-chat ol {
  margin: 0.3em 0 0.6em;
  padding-left: 1.4em;
}

.railyn-chat li {
  margin: 0.15em 0;
  line-height: 1.5;
}

.railyn-chat pre {
  background: var(--p-surface-900, #0f172a);
  color: var(--p-surface-100, #f1f5f9);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.6em 0;
  font-size: 0.8rem;
  line-height: 1.5;
}

.railyn-chat code {
  font-family: ui-monospace, monospace;
  font-size: 0.82em;
  background: var(--p-content-hover-background);
  border-radius: 4px;
  padding: 1px 5px;
}

.railyn-chat pre code {
  background: none;
  padding: 0;
}
</style>
