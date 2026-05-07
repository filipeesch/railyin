<template>
  <ToolCallBlock v-bind="toolCallProps" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FileDiffPayload } from "@shared/rpc-types";
import type { ToolEntry } from "../utils/pairToolMessages";
import { parseToolCallDisplay } from "../utils/toolCallDisplay";
import ToolCallBlock, { type ToolCallProps } from "./ToolCallBlock.vue";

const props = defineProps<{ entry: ToolEntry }>();

function toolEntryToProps(entry: ToolEntry): ToolCallProps {
  const display = parseToolCallDisplay(entry.call.content);

  let parsedResult: {
    is_error?: boolean;
    writtenFiles?: FileDiffPayload[];
  } | null = null;
  if (entry.result) {
    try { parsedResult = JSON.parse(entry.result.content); } catch { /* non-JSON result */ }
  }

  const STALE_MS = 30_000;
  const isStale = !entry.result && entry.call.createdAt
    ? Date.now() - new Date(entry.call.createdAt).getTime() > STALE_MS
    : false;

  const status: ToolCallProps["status"] = !entry.result
    ? (isStale ? "unknown" : "pending")
    : parsedResult?.is_error
      ? "error"
      : "done";

  const callId = (() => {
    try {
      const p = JSON.parse(entry.call.content) as { id?: string };
      return typeof p.id === "string" ? p.id : String(entry.call.id);
    } catch { return String(entry.call.id); }
  })();

  return {
    callId,
    label: display?.label ?? "tool",
    subject: display?.subject,
    contentType: display?.contentType,
    startLine: display?.startLine,
    status,
    result: entry.result?.content ?? undefined,
    diffPayloads: parsedResult?.writtenFiles,
    children: entry.children.map(toolEntryToProps),
  };
}

const toolCallProps = computed(() => toolEntryToProps(props.entry));
</script>
