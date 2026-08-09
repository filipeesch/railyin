<template>
  <div class="fc" :data-testid="testId">
    <button class="fc__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'fc__chevron']" />
      <i :class="['pi', statusIcon.icon, 'fc__status-icon']" :style="statusIcon.style" />
      <code class="fc__tool-name">{{ name }}</code>
      <span v-if="subject" class="fc__primary-arg" :title="subject">{{ formattedSubject }}</span>
      <span v-if="isDiffFamily && stats.added > 0" class="fc__stat fc__stat--added">+{{ stats.added }}</span>
      <span v-if="isDiffFamily && stats.removed > 0" class="fc__stat fc__stat--removed">-{{ stats.removed }}</span>
    </button>

    <div v-if="open" class="fc__body">
      <ReadView v-if="isReadFamily && displayText" :content="displayText" />
      <template v-else-if="isDiffFamily">
        <FileDiff
          v-for="(payload, idx) in payloads"
          :key="`${payload.path}-${payload.to_path ?? ''}-${idx}`"
          :payload="payload"
        />
      </template>
      <div v-else-if="isPending" class="fc__empty">Running…</div>
      <div v-else class="fc__empty">(no content)</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { CopilotChatToolCallRenderSlotProps } from "@copilotkit/vue/v2";
import type { FileDiffPayload } from "@shared/rpc-types";
import { useToolResultDisplay } from "../../../composables/useToolResultDisplay";
import { formatToolSubject } from "../../../utils/toolCallDisplay";
import { computeDiffStats, toolStatusToIcon, isErrorResult, buildDiffPayloadsFromArgs } from "../../../utils/toolCardDisplay";
import FileDiff from "../../FileDiff.vue";
import ReadView from "../../ReadView.vue";

/**
 * FileChangesRenderer — port of the legacy ToolCallBlock diffPayloads branch
 * (ToolCallBlock.vue:108-113 + FileDiff.vue + ReadView.vue) for the read and
 * write/edit/apply_patch families. The wire carries NO display.contentType
 * hint, so the renderer dispatches on the tool NAME family: read tools render
 * the file content body (ReadView windowing), write/edit/patch tools render
 * the FileDiff body with +N/−N stat chips derived from the args.
 */
const READ_NAMES = new Set(["read", "read_file", "view"]);
const DIFF_NAMES = new Set(["write", "write_file", "create", "edit", "multiedit", "apply_patch"]);

const props = defineProps<{
  name: string;
  args?: CopilotChatToolCallRenderSlotProps["args"];
  status?: CopilotChatToolCallRenderSlotProps["status"];
  result?: CopilotChatToolCallRenderSlotProps["result"];
  toolCall?: CopilotChatToolCallRenderSlotProps["toolCall"] | null;
}>();

const testId = computed(() => (props.toolCall ? `tool-card-${props.toolCall.id}` : undefined));

const open = ref(false);

const isReadFamily = computed(() => READ_NAMES.has(props.name));
const isDiffFamily = computed(() => DIFF_NAMES.has(props.name));

// Read family: the result IS the file text — skip detailedContent summaries.
const input = computed(() => ({ result: props.result, contentType: isReadFamily.value ? "file" : undefined }));
const { displayText } = useToolResultDisplay(input);

const payloads = computed<FileDiffPayload[]>(() => (isDiffFamily.value ? buildDiffPayloadsFromArgs(props.args) : []));
const stats = computed(() => computeDiffStats(payloads.value));

const subject = computed(() => extractPath(props.args));
const formattedSubject = computed(() => (subject.value ? formatToolSubject(subject.value, 80) : ""));

const isPending = computed(() => props.status !== "complete");
const isError = computed(() => isErrorResult(props.result));
const statusIcon = computed(() => toolStatusToIcon(props.status ?? "inProgress", isError.value));

/** Primary file path from engine-variant arg keys. */
function extractPath(args: unknown): string {
  if (!args) return "";
  let obj: Record<string, unknown> | null = null;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args) as Record<string, unknown>;
    } catch {
      return "";
    }
  } else if (typeof args === "object") {
    obj = args as Record<string, unknown>;
  }
  if (!obj) return "";
  const v = obj.path ?? obj.file_path ?? obj.filePath ?? obj.target;
  return typeof v === "string" ? v : "";
}
</script>

<style scoped>
.fc {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
  background: var(--p-surface-0, #fff);
}

.fc__header {
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

.fc__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.fc__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.fc__status-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.fc__tool-name {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--p-primary-color, #6366f1);
  font-weight: 600;
  flex-shrink: 0;
}

.fc__primary-arg {
  font-family: monospace;
  font-size: 0.71rem;
  color: var(--p-text-muted-color, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.fc__stat {
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.67rem;
  font-weight: 700;
  flex-shrink: 0;
  font-family: monospace;
}

.fc__stat--added {
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.fc__stat--removed {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-700, #b91c1c);
}

.fc__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
}

.fc__empty {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}
</style>

<style>
html.dark-mode .fc {
  border-color: var(--p-surface-700, #334155);
  background: var(--p-surface-900, #0f172a);
}
html.dark-mode .fc__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}
html.dark-mode .fc__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .fc__body {
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .fc__stat--added {
  background: color-mix(in srgb, var(--p-green-500) 20%, transparent);
  color: var(--p-green-400);
}
html.dark-mode .fc__stat--removed {
  background: color-mix(in srgb, var(--p-red-500) 20%, transparent);
  color: var(--p-red-400);
}
</style>
