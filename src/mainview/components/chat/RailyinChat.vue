<template>
  <div class="railyn-chat">
    <CopilotChat
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
import { computed, ref } from "vue";
import { useToast } from "primevue/usetoast";
import Button from "primevue/button";
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
