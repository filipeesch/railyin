<template>
  <div class="tcg">
    <button class="tcg__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'tcg__chevron']" />
      <i :class="['pi', toolIcon, 'tcg__tool-icon']" />
      <code class="tcg__tool-name">{{ toolName }}</code>
      <span v-if="primaryArg" class="tcg__primary-arg">{{ primaryArg }}</span>
      <span v-if="diffPayload && diffPayload.added > 0" class="tcg__stat tcg__stat--added">+{{ diffPayload.added }}</span>
      <span v-if="diffPayload && diffPayload.removed > 0" class="tcg__stat tcg__stat--removed">-{{ diffPayload.removed }}</span>
    </button>

    <div v-if="open" :class="['tcg__body', (entry.diff || toolName === 'read_file') ? 'tcg__body--flush' : '']">
      <FileDiff v-if="entry.diff" :payload="diffPayload!" />
      <ReadView v-else-if="toolName === 'read_file'" :content="entry.result?.content ?? ''" />
      <pre v-else-if="entry.result" class="tcg__output">{{ truncated }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { ConversationMessage, FileDiffPayload } from "@shared/rpc-types";
import FileDiff from "./FileDiff.vue";
import ReadView from "./ReadView.vue";

export type ToolEntry = {
  call:   ConversationMessage;
  result: ConversationMessage | null;
  diff:   ConversationMessage | null;
};

const props = defineProps<{ entry: ToolEntry }>();

const open = ref(false);

const TOOL_ICONS: Record<string, string> = {
  read_file:       "pi-file",
  list_dir:        "pi-folder-open",
  write_file:      "pi-file-edit",
  patch_file:      "pi-file-edit",
  delete_file:     "pi-trash",
  rename_file:     "pi-arrow-right-arrow-left",
  search_text:     "pi-search",
  run_command:     "pi-terminal",
  fetch_url:       "pi-globe",
  search_internet: "pi-globe",
  spawn_agent:     "pi-microchip-ai",
};

const parsedCall = computed(() => {
  try {
    const p = JSON.parse(props.entry.call.content) as {
      name?: string;
      function?: { name?: string };
      arguments?: string | Record<string, unknown>;
    };
    const name = p?.name ?? p?.function?.name ?? "tool";
    const args: Record<string, unknown> =
      typeof p?.arguments === "string"
        ? JSON.parse(p.arguments as string)
        : (p?.arguments ?? {});
    return { name, args };
  } catch {
    return { name: "tool", args: {} as Record<string, unknown> };
  }
});

const toolName = computed(() => parsedCall.value.name);
const toolIcon = computed(() => TOOL_ICONS[toolName.value] ?? "pi-code");

const primaryArg = computed(() => {
  const { args } = parsedCall.value;
  const val = String(
    args.path ?? args.from_path ?? args.pattern ?? args.url ?? args.command ?? "",
  );
  return val.length > 60 ? "…" + val.slice(-57) : val;
});

const truncated = computed(() => {
  const c = props.entry.result?.content ?? "";
  return c.length > 800 ? c.slice(0, 800) + "\n…[truncated]" : c;
});

const diffPayload = computed<FileDiffPayload | null>(() => {
  if (!props.entry.diff) return null;
  try {
    return JSON.parse(props.entry.diff.content) as FileDiffPayload;
  } catch {
    return { operation: "write_file", path: "unknown", added: 0, removed: 0 };
  }
});
</script>

<style scoped>
.tcg {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
  font-size: 0.82rem;
}

/* ── Collapsed header ────────────────────────────────────────────── */

.tcg__header {
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

.tcg__header:hover {
  background: var(--p-surface-100, #f0f0f0);
}

.tcg__chevron {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.65rem;
  flex-shrink: 0;
}

.tcg__tool-icon {
  color: var(--p-text-muted-color, #94a3b8);
  font-size: 0.72rem;
  flex-shrink: 0;
}

.tcg__tool-name {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--p-primary-color, #6366f1);
  font-weight: 600;
  flex-shrink: 0;
}

.tcg__primary-arg {
  font-family: monospace;
  font-size: 0.71rem;
  color: var(--p-text-muted-color, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.tcg__badge {
  display: flex;
  align-items: center;
  gap: 3px;
  background: #e0f2fe;
  color: #0369a1;
  border-radius: 10px;
  padding: 1px 7px;
  font-size: 0.67rem;
  font-weight: 600;
  flex-shrink: 0;
}

.tcg__badge-icon {
  font-size: 0.6rem;
}

.tcg__stat {
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 0.67rem;
  font-weight: 700;
  flex-shrink: 0;
  font-family: monospace;
}

.tcg__stat--added {
  background: #dcfce7;
  color: #16a34a;
}

.tcg__stat--removed {
  background: #fee2e2;
  color: #dc2626;
}

/* ── Expanded body ────────────────────────────────────────────────── */

.tcg__body {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 8px 12px;
  background: var(--p-surface-0, #fff);
}

.tcg__body--flush {
  padding: 0;
}

.tcg__output {
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
</style>
