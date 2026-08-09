<template>
  <div class="ts" :data-testid="testId">
    <button class="ts__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'ts__chevron']" />
      <i :class="['pi', statusIcon.icon, 'ts__status-icon']" :style="statusIcon.style" />
      <code class="ts__tool-name">{{ name }}</code>
      <span v-if="command" class="ts__primary-arg" :title="command">{{ formattedCommand }}</span>
    </button>

    <div v-if="open" class="ts__body">
      <pre v-if="displayText" class="ts__output">{{ truncated }}</pre>
      <div v-else-if="isPending" class="ts__empty">Running…</div>
      <div v-else class="ts__empty">(no output)</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { CopilotChatToolCallRenderSlotProps } from "@copilotkit/vue/v2";
import { useToolResultDisplay } from "../../../composables/useToolResultDisplay";
import { formatToolSubject } from "../../../utils/toolCallDisplay";
import { truncateToolOutput, toolStatusToIcon, isErrorResult } from "../../../utils/toolCardDisplay";

/**
 * ShellOutputRenderer — port of the legacy ToolCallBlock output branch
 * (ToolCallBlock.vue:79-106, 236-246) for the bash/run/run_in_terminal
 * families. Renders the pre-formatted command output truncated at 800 chars;
 * pending calls show a spinner + "Running…", done calls a green check, and
 * failure is detected from RESULT CONTENT only (the wire's status is
 * "complete" for errored calls too — RESEARCH Pitfall 3).
 */
const props = defineProps<{
  name: string;
  args?: CopilotChatToolCallRenderSlotProps["args"];
  status?: CopilotChatToolCallRenderSlotProps["status"];
  result?: CopilotChatToolCallRenderSlotProps["result"];
  toolCall?: CopilotChatToolCallRenderSlotProps["toolCall"] | null;
}>();

const testId = computed(() => (props.toolCall ? `tool-card-${props.toolCall.id}` : undefined));

const open = ref(false);

const input = computed(() => ({ result: props.result, contentType: undefined }));
const { displayText } = useToolResultDisplay(input);

const truncated = computed(() => truncateToolOutput(displayText.value));

const isPending = computed(() => props.status !== "complete");
const isError = computed(() => isErrorResult(props.result));
const statusIcon = computed(() => toolStatusToIcon(props.status ?? "inProgress", isError.value));

const command = computed(() => extractCommand(props.args));
const formattedCommand = computed(() => (command.value ? formatToolSubject(command.value, 80) : ""));

/** Primary command from engine-variant arg keys (bash: `command`, others: `cmd`/`commandLine`). */
function extractCommand(args: unknown): string {
  if (!args) return "";
  let obj: Record<string, unknown> | null = null;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args) as Record<string, unknown>;
    } catch {
      return args;
    }
  } else if (typeof args === "object") {
    obj = args as Record<string, unknown>;
  }
  if (!obj) return "";
  const v = obj.command ?? obj.cmd ?? obj.commandLine;
  return typeof v === "string" ? v : "";
}
</script>

<style scoped>
.ts {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
  background: var(--p-surface-0, #fff);
}

.ts__header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 7px 10px;
  background: var(--p-surface-50, #f9fafb);
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: inherit;
  font-family: inherit;
  color: var(--p-text-color, #333);
}

.ts__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.ts__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.ts__status-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.ts__tool-name {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--p-primary-color, #6366f1);
  font-weight: 600;
  flex-shrink: 0;
}

.ts__primary-arg {
  font-family: monospace;
  font-size: 0.71rem;
  color: var(--p-text-muted-color, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.ts__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
}

.ts__output {
  margin: 0;
  font-family: monospace;
  font-size: 0.71rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  color: var(--p-text-color, #1e293b);
  line-height: 1.5;
}

.ts__empty {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}
</style>

<style>
html.dark-mode .ts {
  border-color: var(--p-surface-700, #334155);
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .ts__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}
html.dark-mode .ts__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .ts__body {
  border-top-color: var(--p-surface-700, #334155);
}
</style>
