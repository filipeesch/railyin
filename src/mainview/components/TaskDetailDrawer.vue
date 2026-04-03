<template>
  <Drawer
    v-model:visible="open"
    position="right"
    :style="{ width: '700px' }"
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
        <div class="task-detail__conversation" ref="scrollEl">
          <div class="conversation-inner">
            <MessageBubble
              v-for="msg in taskStore.messages"
              :key="msg.id"
              :chunk="msg"
            />

            <!-- Live streaming bubble -->
            <div
              v-if="taskStore.streamingToken"
              class="msg msg--assistant"
            >
              <div class="msg__bubble streaming">
                {{ taskStore.streamingToken }}<span class="cursor">▌</span>
              </div>
              <div class="msg__meta">AI</div>
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
        <InputText
          v-model="inputText"
          placeholder="Send a message…"
          class="flex-1"
          :disabled="task.executionState === 'running'"
          @keydown.enter.prevent="send"
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
import Drawer from "primevue/drawer";
import Tag from "primevue/tag";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import ProgressSpinner from "primevue/progressspinner";
import MessageBubble from "./MessageBubble.vue";
import { useTaskStore } from "../stores/task";
import { useBoardStore } from "../stores/board";
import type { ExecutionState } from "@shared/rpc-types";

const taskStore = useTaskStore();
const boardStore = useBoardStore();

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

// Auto-scroll to bottom when messages change
watch(
  [() => taskStore.messages.length, () => taskStore.streamingToken],
  async () => {
    await nextTick();
    if (scrollEl.value) {
      scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
    }
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
  white-space: pre-wrap;
  word-break: break-word;
}

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
