<template>
  <div v-if="chunk.type === 'user'" class="msg msg--user">
    <div class="msg__bubble">{{ chunk.content }}</div>
    <div class="msg__meta">You</div>
  </div>

  <div v-else-if="chunk.type === 'assistant'" class="msg msg--assistant">
    <div class="msg__bubble">{{ chunk.content }}</div>
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
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ConversationMessage } from "@shared/rpc-types";

const props = defineProps<{ chunk: ConversationMessage }>();

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
  white-space: pre-wrap;
  word-break: break-word;
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
</style>
