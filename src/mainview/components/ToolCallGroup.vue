<template>
  <div class="tcg">
    <button class="tcg__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'tcg__chevron']" />
      <i :class="['pi', statusIcon, 'tcg__tool-icon']" :style="statusIconStyle" />
      <code class="tcg__tool-name">{{ toolName }}</code>
      <span v-if="primaryArg" class="tcg__primary-arg">{{ primaryArg }}</span>
      <span v-if="hasChildren" class="tcg__badge">
        <i class="pi pi-sitemap tcg__badge-icon" />
        {{ entry.children.length }}
      </span>
      <span v-if="effectiveDiffPayload && effectiveDiffPayload.added > 0" class="tcg__stat tcg__stat--added">+{{ effectiveDiffPayload.added }}</span>
      <span v-if="effectiveDiffPayload && effectiveDiffPayload.removed > 0" class="tcg__stat tcg__stat--removed">-{{ effectiveDiffPayload.removed }}</span>
    </button>

    <div v-if="open" :class="['tcg__body', (effectiveDiffPayload || toolName === 'read_file') ? 'tcg__body--flush' : '']">
      <FileDiff v-if="effectiveDiffPayload" :payload="effectiveDiffPayload" />
      <ReadView v-else-if="toolName === 'read_file'" :content="displayContent" :startLine="readFileStartLine" />
      <div v-else-if="entry.result && displayBlocks.length > 0" class="tcg__blocks">
        <section v-for="block in displayBlocks" :key="block.key" class="tcg__block">
          <div class="tcg__block-label">{{ block.label }}</div>
          <pre class="tcg__output tcg__output--block">{{ block.content }}</pre>
        </section>
      </div>
      <pre v-else-if="entry.result && hasOutput" class="tcg__output">{{ truncated }}</pre>
      <div v-else-if="entry.result && !hasChildren" class="tcg__empty">No output produced.</div>

      <div v-if="hasChildren" class="tcg__children">
        <ToolCallGroup
          v-for="child in entry.children"
          :key="child.call.id"
          :entry="child"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from "vue";
import type { FileDiffPayload, Hunk } from "@shared/rpc-types";
import type { ToolEntry } from "../utils/pairToolMessages";
import FileDiff from "./FileDiff.vue";
import ReadView from "./ReadView.vue";

const props = defineProps<{ entry: ToolEntry }>();

const open = ref(false);
const TOOL_TIMEOUT_MS = 30_000;
const hasTimedOut = ref(false);
let timeoutId: ReturnType<typeof setTimeout> | null = null;

const parsedCall = computed(() => {
  try {
    const p = JSON.parse(props.entry.call.content) as {
      name?: string;
      function?: { name?: string; arguments?: string | Record<string, unknown> };
      arguments?: string | Record<string, unknown>;
    };
    const name = p?.name ?? p?.function?.name ?? "tool";
    const rawArgs = p?.function?.arguments ?? p?.arguments;
    const args: Record<string, unknown> =
      typeof rawArgs === "string"
        ? JSON.parse(rawArgs)
        : (rawArgs ?? {});
    return { name, args };
  } catch {
    return { name: "tool", args: {} as Record<string, unknown> };
  }
});

const toolName = computed(() => parsedCall.value.name);
const hasChildren = computed(() => props.entry.children.length > 0);

// Outcome icon: spinner while running, check on success, times on error
const parsedResult = computed(() => {
  if (!props.entry.result) return null;
  try {
    return JSON.parse(props.entry.result.content) as {
      type?: string;
      tool_use_id?: string;
      content?: string;
      detailedContent?: string;
      contents?: Array<Record<string, unknown>>;
      is_error?: boolean;
    };
  } catch {
    return null;
  }
});

type DisplayBlock = {
  key: string;
  label: string;
  content: string;
};

const statusIcon = computed(() => {
  if (!props.entry.result) return hasTimedOut.value ? "pi-question-circle" : "pi-spin pi-spinner";
  return parsedResult.value?.is_error ? "pi-times-circle" : "pi-check-circle";
});

const statusIconStyle = computed(() => {
  if (!props.entry.result) {
    return hasTimedOut.value ? { color: "#94a3b8" } : undefined;
  }
  return { color: parsedResult.value?.is_error ? "#dc2626" : "#16a34a" };
});

const primaryArg = computed(() => {
  const { args } = parsedCall.value;
  const val = String(
    args.path ?? args.from_path ?? args.pattern ?? args.url ?? args.command ?? "",
  );
  return val.length > 60 ? "…" + val.slice(-57) : val;
});

const readFileStartLine = computed(() => {
  const { args } = parsedCall.value;
  const raw = args.startLine ?? args.start_line ?? args.from_line;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
});

const truncated = computed(() => {
  const c = displayContent.value;
  return c.length > 800 ? c.slice(0, 800) + "\n…[truncated]" : c;
});

const displayContent = computed(() => {
  const parsed = parsedResult.value;
  if (parsed?.detailedContent?.trim()) return parsed.detailedContent.trim();

  const contentBlocks = parsed?.contents ?? [];
  const textFromBlocks = contentBlocks
    .flatMap((block) => {
      if (block.type === "text" && typeof block.text === "string") return [block.text];
      if (block.type === "terminal" && typeof block.text === "string") return [block.text];
      return [];
    })
    .join("\n\n")
    .trim();
  if (textFromBlocks) return textFromBlocks;

  return (parsed?.content ?? props.entry.result?.content ?? "").trim();
});

const displayBlocks = computed<DisplayBlock[]>(() => {
  const parsed = parsedResult.value;
  const blocks = parsed?.contents ?? [];
  return blocks.flatMap((block, index) => {
    const label = block.type === "terminal"
      ? "Terminal output"
      : block.type === "text"
        ? "Text output"
        : "Output block";

    const text = typeof block.text === "string"
      ? block.text
      : typeof block.content === "string"
        ? block.content
        : "";

    if (text.trim()) {
      return [{ key: `${block.type ?? "block"}-${index}`, label, content: text.trim() }];
    }

    if (block.type === "text" || block.type === "terminal") {
      return [];
    }

    const fallback = JSON.stringify(block, null, 2).trim();
    return fallback
      ? [{ key: `${block.type ?? "block"}-${index}`, label, content: fallback }]
      : [];
  });
});

const hasOutput = computed(() => displayContent.value.length > 0);

const diffPayload = computed<FileDiffPayload | null>(() => {
  if (!props.entry.diff) return null;
  try {
    const parsed = JSON.parse(props.entry.diff.content) as FileDiffPayload & {
      rawDiff?: string;
    };
    if (typeof parsed.rawDiff === "string") {
      return parseUnifiedDiff(parsed.rawDiff, parsed.path, parsed.operation);
    }
    return parsed;
  } catch {
    return { operation: "write_file", path: "unknown", added: 0, removed: 0 };
  }
});

const effectiveDiffPayload = computed<FileDiffPayload | null>(() => {
  return diffPayload.value ?? inferDiffPayload(displayContent.value, toolName.value, parsedCall.value.args);
});

function inferDiffPayload(
  text: string,
  rawToolName: string,
  args: Record<string, unknown>,
): FileDiffPayload | null {
  const diffText = extractUnifiedDiff(text);
  if (!diffText) return null;
  const path = String(args.path ?? args.filePath ?? args.target_file ?? args.from_path ?? "unknown");
  const operation = inferOperation(rawToolName, args);
  const parsed = parseUnifiedDiff(diffText, path, operation);
  return (parsed.hunks?.length ?? 0) > 0 || parsed.operation === "rename_file" ? parsed : null;
}

function extractUnifiedDiff(text: string): string | null {
  const fenced = text.match(/```diff\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? text).trim();
  if (!candidate.includes("@@") && !candidate.includes("--- ") && !candidate.includes("+++ ")) {
    return null;
  }
  return candidate;
}

function inferOperation(toolName: string, args: Record<string, unknown>): FileDiffPayload["operation"] {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("rename")) return "rename_file";
  if (normalized.includes("delete")) return "delete_file";
  if (normalized.includes("patch")) return "patch_file";
  if (normalized.includes("edit")) return "edit_file";
  if (args.from_path && args.to_path) return "rename_file";
  return "write_file";
}

function parseUnifiedDiff(
  diffText: string,
  fallbackPath: string,
  operation: FileDiffPayload["operation"],
): FileDiffPayload {
  const lines = diffText.split("\n");
  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let path = fallbackPath;
  let toPath: string | undefined;
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      path = normalizeDiffPath(line.slice(4).trim(), fallbackPath);
      continue;
    }
    if (line.startsWith("+++ ")) {
      toPath = normalizeDiffPath(line.slice(4).trim(), fallbackPath);
      continue;
    }
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      currentHunk = {
        old_start: Number(header[1]),
        new_start: Number(header[2]),
        lines: [],
      };
      hunks.push(currentHunk);
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({ type: "added", new_line: newLine, content: line.slice(1) });
      newLine += 1;
      added += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({ type: "removed", old_line: oldLine, content: line.slice(1) });
      oldLine += 1;
      removed += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", old_line: oldLine, new_line: newLine, content: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    }
  }

  return {
    operation,
    path,
    ...(toPath && toPath !== path ? { to_path: toPath } : {}),
    added,
    removed,
    ...(hunks.length > 0 ? { hunks } : {}),
  };
}

function normalizeDiffPath(path: string, fallbackPath: string): string {
  const cleaned = path.replace(/^a\//, "").replace(/^b\//, "");
  return cleaned === "/dev/null" ? fallbackPath : cleaned;
}

function clearTimeoutHandle() {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function syncTimeoutState() {
  clearTimeoutHandle();

  if (props.entry.result) {
    hasTimedOut.value = false;
    return;
  }

  const createdAt = new Date(props.entry.call.createdAt).getTime();
  if (!Number.isFinite(createdAt)) {
    hasTimedOut.value = true;
    return;
  }

  const remaining = TOOL_TIMEOUT_MS - (Date.now() - createdAt);
  if (remaining <= 0) {
    hasTimedOut.value = true;
    return;
  }

  hasTimedOut.value = false;
  timeoutId = setTimeout(() => {
    hasTimedOut.value = true;
    timeoutId = null;
  }, remaining);
}

watch(
  () => [props.entry.result?.id ?? null, props.entry.call.createdAt] as const,
  syncTimeoutState,
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTimeoutHandle();
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
  background: var(--p-blue-100, #e0f2fe);
  color: var(--p-blue-700, #0369a1);
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
  background: var(--p-green-100, #dcfce7);
  color: var(--p-green-700, #15803d);
}

.tcg__stat--removed {
  background: var(--p-red-100, #fee2e2);
  color: var(--p-red-700, #b91c1c);
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

.tcg__blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tcg__block {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.tcg__block-label {
  padding: 6px 10px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--p-text-muted-color, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

.tcg__output--block {
  padding: 8px 10px;
}

.tcg__empty {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  font-style: italic;
}

.tcg__children {
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--p-surface-200, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

<style>
html.dark-mode .tcg {
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__header {
  background: var(--p-surface-800, #1e293b);
  color: var(--p-text-color);
}
html.dark-mode .tcg__header:hover {
  background: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__body {
  background: var(--p-surface-900, #0f172a);
  border-top-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__block {
  border-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__block-label {
  background: var(--p-surface-800, #1e293b);
  border-bottom-color: var(--p-surface-700, #334155);
}
html.dark-mode .tcg__stat--added {
  background: color-mix(in srgb, var(--p-green-500) 20%, transparent);
  color: var(--p-green-400);
}
html.dark-mode .tcg__stat--removed {
  background: color-mix(in srgb, var(--p-red-500) 20%, transparent);
  color: var(--p-red-400);
}
html.dark-mode .tcg__badge {
  background: color-mix(in srgb, var(--p-blue-500) 20%, transparent);
  color: var(--p-blue-300);
}
html.dark-mode .tcg__children {
  border-left-color: var(--p-surface-700, #334155);
}
</style>
