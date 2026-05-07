<template>
  <div class="tc">
    <button class="tc__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'tc__chevron']" />
      <i :class="['pi', statusIcon, 'tc__tool-icon']" :style="statusIconStyle" />
      <code class="tc__tool-name">{{ label }}</code>
      <span v-if="formattedSubject" class="tc__primary-arg" :title="subjectTitle">{{ formattedSubject }}</span>
      <span v-if="totalAdded > 0" class="tc__stat tc__stat--added">+{{ totalAdded }}</span>
      <span v-if="totalRemoved > 0" class="tc__stat tc__stat--removed">-{{ totalRemoved }}</span>
      <span
        v-if="hasChildren"
        :class="['tc__badge', status === 'pending' && hasChildren ? 'tc__badge--pulsing' : '']"
      >
        <i class="pi pi-sitemap tc__badge-icon" />
        {{ children!.length }}
      </span>
    </button>

    <div v-if="open" :class="['tc__body', isFlush ? 'tc__body--flush' : '']">
      <template v-if="diffPayloads && diffPayloads.length > 0">
        <FileDiff
          v-for="(payload, idx) in diffPayloads"
          :key="`${payload.path}-${payload.to_path ?? ''}-${idx}`"
          :payload="payload"
        />
      </template>
      <ReadView
        v-else-if="contentType === 'file' && result"
        :content="displayText"
        :startLine="startLine"
      />
      <pre v-else-if="result && displayText" class="tc__output">{{ truncated }}</pre>
      <div v-else-if="!result && status === 'pending'" class="tc__empty">Running…</div>

      <!-- Slot for streaming children (StreamBlockNode uses this); falls back to prop children -->
      <slot name="children">
        <div v-if="hasChildren" class="tc__children">
          <ToolCallBlock
            v-for="child in children"
            :key="child.callId"
            v-bind="child"
          />
        </div>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { FileDiffPayload } from "@shared/rpc-types";
import { useToolResultDisplay } from "../composables/useToolResultDisplay";
import { formatToolSubject } from "../utils/toolCallDisplay";
import FileDiff from "./FileDiff.vue";
import ReadView from "./ReadView.vue";

export interface ToolCallProps {
  callId: string;
  label: string;
  subject?: string;
  contentType?: string;
  startLine?: number;
  status: "pending" | "done" | "error" | "unknown";
  result?: string;
  diffPayloads?: FileDiffPayload[];
  children?: ToolCallProps[];
}

const props = defineProps<ToolCallProps>();

const open = ref(false);

const input = computed(() => ({
  result: props.result,
  contentType: props.contentType,
}));
const { displayText } = useToolResultDisplay(input);

const truncated = computed(() => {
  const c = displayText.value;
  return c.length > 800 ? c.slice(0, 800) + "\n…[truncated]" : c;
});

const hasChildren = computed(() => (props.children?.length ?? 0) > 0);

const subjectTitle = computed(() => props.subject ?? "");

const formattedSubject = computed(() => {
  const s = props.subject ?? "";
  if (!s) return "";
  const base = formatToolSubject(s, 80);
  return props.startLine != null && props.startLine > 0 ? `${base}:${props.startLine}` : base;
});

const statusIcon = computed(() => {
  if (props.status === "error") return "pi-times-circle";
  if (props.status === "done") return "pi-check-circle";
  if (props.status === "unknown") return "pi-question-circle";
  return "pi-spin pi-spinner";
});

const statusIconStyle = computed(() => {
  if (props.status === "error") return { color: "#dc2626" };
  if (props.status === "done") return { color: "#16a34a" };
  return undefined;
});

const totalAdded = computed(() =>
  (props.diffPayloads ?? []).reduce((sum, p) => sum + (p.added ?? 0), 0),
);
const totalRemoved = computed(() =>
  (props.diffPayloads ?? []).reduce((sum, p) => sum + (p.removed ?? 0), 0),
);

const isFlush = computed(
  () => (props.diffPayloads?.length ?? 0) > 0 || props.contentType === "file",
);
</script>

<style scoped>
.tc {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
}

/* ── Collapsed header ────────────────────────────────────────────── */

.tc__header {
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

.tc__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.tc__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.tc__tool-icon {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.72rem;
  flex-shrink: 0;
}

.tc__tool-name {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--p-primary-color, #6366f1);
  font-weight: 600;
  flex-shrink: 0;
}

.tc__primary-arg {
  font-family: monospace;
  font-size: 0.71rem;
  color: var(--p-text-muted-color, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.tc__badge {
  display: flex;
  align-items: center;
  gap: 3px;
  background: var(--p-blue-100, #e0f2fe);
  color: var(--p-blue-700, #0369a1);
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.67rem;
  font-weight: 600;
  flex-shrink: 0;
}

.tc__badge-icon {
  font-size: 0.6rem;
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.tc__badge--pulsing {
  animation: badge-pulse 1.5s ease-in-out infinite;
}

.tc__stat {
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.67rem;
  font-weight: 700;
  flex-shrink: 0;
  font-family: monospace;
}

.tc__stat--added {
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.tc__stat--removed {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-700, #b91c1c);
}

/* ── Expanded body ────────────────────────────────────────────────── */

.tc__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
  background: var(--p-surface-0, #fff);
}

.tc__body--flush {
  padding: 0;
}

.tc__output {
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

.tc__empty {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}

.tc__children {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--p-surface-200, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

<style>
html.dark-mode .tc {
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .tc__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}
html.dark-mode .tc__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .tc__body {
  background: var(--p-surface-900, #0f172a);
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .tc__stat--added {
  background: color-mix(in srgb, var(--p-green-500) 20%, transparent);
  color: var(--p-green-400);
}
html.dark-mode .tc__stat--removed {
  background: color-mix(in srgb, var(--p-red-500) 20%, transparent);
  color: var(--p-red-400);
}
html.dark-mode .tc__badge {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}
html.dark-mode .tc__children {
  border-left-color: var(--p-surface-700, #334155);
}
</style>
