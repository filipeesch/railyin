<template>
  <div :class="['conv-input', { 'task-detail__input': props.taskId != null }]">
    <!-- Pending code refs -->
    <div v-if="pendingCodeRefs.length > 0" class="conv-input__attachments">
      <span
        v-for="(ref, idx) in pendingCodeRefs"
        :key="`${ref.file}:${ref.startLine}:${ref.startChar}:${idx}`"
        class="attachment-chip code-ref-chip"
      >
        <span class="code-ref-chip__label">{{ formatCodeRefLabel(ref) }}</span>
        <button
          class="attachment-chip__remove code-ref-chip__dismiss"
          aria-label="Remove code reference"
          @click="removeCodeRef(idx)"
        >✕</button>
      </span>
    </div>

    <!-- Pending attachment chips -->
    <div v-if="pendingAttachments.length > 0" class="conv-input__attachments">
      <span
        v-for="(att, idx) in pendingAttachments"
        :key="idx"
        class="attachment-chip"
      >
        📎 {{ att.label }}
        <button
          class="attachment-chip__remove"
          aria-label="Remove attachment"
          @click="pendingAttachments.splice(idx, 1)"
        >✕</button>
      </span>
    </div>

    <!-- Hidden file input (task mode only) -->
    <input
      v-if="props.taskId != null"
      ref="fileInputRef"
      type="file"
      accept="*"
      multiple
      style="display: none"
      @change="onFileInputChange"
    />

    <!-- Input row -->
    <div class="conv-input__row" @paste="props.taskId != null ? onPaste($event) : undefined">
      <ChatEditor
        ref="chatEditorRef"
        :task-id="props.taskId"
        :workspace-key="props.workspaceKey"
        :disabled="isDisabled"
        placeholder="Send a message… (Shift+Enter for newline)"
        class="flex-1"
        @send="onChatEditorSend"
        @text-change="inputText = $event"
      />

      <!-- Attach button (task mode only, not running) -->
      <Button
        v-if="props.taskId != null && !isRunning && !props.compacting"
        icon="pi pi-paperclip"
        text
        rounded
        size="small"
        v-tooltip="'Attach image'"
        @click="fileInputRef?.click()"
      />

      <!-- Cancel / compacting / send button -->
      <Button
        v-if="isRunning"
        icon="pi pi-stop-circle"
        severity="warn"
        data-testid="cancel-btn"
        @click="emit('cancel')"
      />
      <Button
        v-else-if="props.compacting"
        :loading="true"
        :disabled="true"
      />
      <Button
        v-else
        icon="pi pi-send"
        :disabled="!canSend"
        data-testid="send-btn"
        @click="send"
      />
    </div>

    <!-- Model row: selector + context ring + MCP + shell auto-approve -->
    <div :class="['conv-input__model-row', { 'task-detail__model-row': props.taskId != null }]">
      <!-- Model selector -->
      <template v-if="workspaceStore.availableModels.length > 0">
        <Select
          :model-value="props.modelId ?? workspaceStore.availableModels[0]?.id ?? null"
          :options="groupedModels"
          option-group-label="label"
          option-group-children="items"
          option-label="label"
          option-value="id"
          filter
          filter-placeholder="Search models…"
          size="small"
          class="input-model-select"
          @change="(e: { value: string | null }) => emit('update:modelId', e.value)"
        >
          <template #value="{ value, placeholder }">
            <span
              v-if="selectedModelOption"
              class="model-select__value"
              :title="selectedModelOption.description ?? selectedModelOption.id ?? undefined"
            >
              {{ selectedModelOption.label }}
            </span>
            <span v-else class="p-select-label p-placeholder">{{ placeholder }}</span>
          </template>
          <template #option="{ option }">
            <div
              class="model-select__option"
              :title="option.description ?? option.id ?? undefined"
            >
              <div class="model-select__option-title">{{ option.label }}</div>
              <div v-if="option.description" class="model-select__option-description">{{ option.description }}</div>
              <div v-if="option.id" class="model-select__option-id">{{ option.id }}</div>
            </div>
          </template>
          <template #footer>
            <div class="model-select-footer">
              <Button
                label="⚙ Manage models"
                text
                size="small"
                @click="emit('manageModels')"
              />
            </div>
          </template>
        </Select>
      </template>
      <template v-else>
        <div class="model-empty-state">
          <span class="model-empty-label">No models enabled</span>
          <Button
            label="⚙ Manage models"
            text
            size="small"
            @click="emit('manageModels')"
          />
        </div>
      </template>

      <!-- Context ring (when contextUsage provided) -->
      <button
        v-if="props.contextUsage"
        ref="contextRingBtnRef"
        class="context-ring-btn"
        :title="`~${props.contextUsage.usedTokens.toLocaleString()} / ${props.contextUsage.maxTokens.toLocaleString()} tokens (${Math.round(props.contextUsage.fraction * 100)}%)`"
        @click="contextPopoverRef?.toggle($event)"
      >
        <svg class="context-ring" width="28" height="28" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="10" fill="none" stroke-width="3" class="context-ring__track" />
          <circle
            cx="14" cy="14" r="10" fill="none" stroke-width="3"
            stroke-linecap="round"
            stroke-dasharray="62.83"
            :stroke-dashoffset="62.83 * (1 - props.contextUsage.fraction)"
            :stroke="props.contextUsage.fraction >= 0.90 ? 'var(--p-red-500, #ef4444)' : props.contextUsage.fraction >= 0.70 ? 'var(--p-yellow-500, #eab308)' : 'var(--p-green-500, #22c55e)'"
            transform="rotate(-90 14 14)"
          />
          <text
            v-if="props.contextUsage.fraction > 0"
            x="14" y="18"
            text-anchor="middle"
            font-size="7"
            class="context-ring__label"
          >{{ Math.round(props.contextUsage.fraction * 100) }}%</text>
        </svg>
      </button>
      <ContextPopover
        v-if="props.contextUsage"
        ref="contextPopoverRef"
        :context-usage="props.contextUsage"
        :model-display-name="selectedModelOption?.label"
        :supports-manual-compact="supportsManualCompact"
        :disabled="isRunning"
        @compact="emit('compact')"
      />

      <!-- MCP tools button -->
      <template v-if="props.taskId != null || props.sessionId != null">
        <Button
          v-tooltip="'MCP Tools'"
          icon="pi pi-wrench"
          :severity="mcpHasWarning ? 'danger' : 'secondary'"
          text
          rounded
          size="small"
          :class="['conv-input__mcp-btn', { 'task-detail__mcp-btn': props.taskId != null }]"
          @click="mcpPopoverRef?.toggle($event)"
        />
        <McpToolsPopover
          ref="mcpPopoverRef"
          :task-id="props.taskId"
          :session-id="props.sessionId"
          :enabled-mcp-tools="props.enabledMcpTools ?? null"
          @edit-config="onMcpEditConfig"
          @tools-changed="(t) => emit('toolsChanged', t)"
        />
        <FileEditorOverlay
          :visible="mcpEditorVisible"
          title="Edit mcp.json"
          :content="mcpConfigContent"
          language="json"
          note="Editing global MCP server configuration (~/.railyn/mcp.json). Save to reload servers."
          @close="mcpEditorVisible = false"
          @save="onMcpConfigSave"
        />
      </template>

      <!-- Shell auto-approve toggle (task mode only) -->
      <div
        v-if="props.taskId != null"
        class="shell-autoapprove-toggle"
        :title="props.shellAutoApprove ? 'Shell auto-approve ON — commands run without prompting' : 'Shell auto-approve OFF — commands require approval'"
      >
        <ToggleSwitch
          :model-value="props.shellAutoApprove"
          size="small"
          @update:model-value="emit('update:shellAutoApprove', $event)"
        />
        <span class="shell-autoapprove-label">Auto-approve shell</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import ChatEditor from "./ChatEditor.vue";
import McpToolsPopover from "./McpToolsPopover.vue";
import ContextPopover from "./ContextPopover.vue";
import FileEditorOverlay from "./FileEditorOverlay.vue";
import { useWorkspaceStore } from "../stores/workspace";
import { useCodeServerStore } from "../stores/codeServer";
import { useToast } from "primevue/usetoast";
import { api } from "../rpc";
import type { Attachment, ChatSession, CodeRef, McpServerStatus, Task } from "@shared/rpc-types";

const props = defineProps<{
  executionState: string;
  taskId?: number | null;
  sessionId?: number | null;
  workspaceKey?: string | null;
  modelId?: string | null;
  contextUsage?: { usedTokens: number; maxTokens: number; fraction: number } | null;
  compacting?: boolean;
  enabledMcpTools?: string[] | null;
  shellAutoApprove?: boolean;
}>();

const emit = defineEmits<{
  send: [text: string, attachments: Attachment[]];
  cancel: [];
  "update:modelId": [string | null];
  compact: [];
  manageModels: [];
  toolsChanged: [target: Task | ChatSession];
  "update:shellAutoApprove": [boolean];
}>();

const workspaceStore = useWorkspaceStore();
const codeServerStore = useCodeServerStore();
const toast = useToast();

// ─── State ─────────────────────────────────────────────────────────────────────

const inputText = ref("");
const pendingAttachments = ref<Attachment[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const chatEditorRef = ref<InstanceType<typeof ChatEditor> | null>(null);
const mcpPopoverRef = ref<InstanceType<typeof McpToolsPopover> | null>(null);
const contextPopoverRef = ref<InstanceType<typeof ContextPopover> | null>(null);
const mcpEditorVisible = ref(false);
const mcpConfigContent = ref("{}");
const mcpStatuses = ref<McpServerStatus[]>([]);

// ─── Computed ─────────────────────────────────────────────────────────────────

const isRunning = computed(() => props.executionState === "running");
const isDisabled = computed(() => isRunning.value || !!props.compacting);
const pendingCodeRefs = computed(() => (
  props.taskId != null ? (codeServerStore.pendingRefs.get(props.taskId) ?? []) : []
));
const canSend = computed(() => (
  inputText.value.trim().length > 0 ||
  pendingAttachments.value.length > 0 ||
  pendingCodeRefs.value.length > 0
));

const mcpHasWarning = computed(() => mcpStatuses.value.some((status) => status.state === "error"));

const groupedModels = computed(() => {
  const groups: Record<string, Array<{ id: string | null; label: string; description?: string; contextWindow: number | null }>> = {};
  for (const model of workspaceStore.availableModels) {
    const provider = model.id == null
      ? "copilot"
      : (model.id.includes("/") ? model.id.slice(0, model.id.indexOf("/")) : "other");
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push({
      id: model.id,
      label: model.displayName ?? model.id ?? "Auto",
      description: model.description,
      contextWindow: model.contextWindow,
    });
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
});

const selectedModelOption = computed(() => {
  const selectedId = props.modelId ?? (workspaceStore.availableModels[0]?.id ?? null);
  for (const group of groupedModels.value) {
    const found = group.items.find((item) => item.id === selectedId);
    if (found) return found;
  }
  return null;
});

const supportsManualCompact = computed(() =>
  workspaceStore.availableModels.find(
    (model) => model.id === (props.modelId ?? workspaceStore.availableModels[0]?.id ?? null),
  )?.supportsManualCompact === true
);

// ─── Send logic ───────────────────────────────────────────────────────────────

function send() {
  if (!canSend.value) return;
  if (!inputText.value.trim()) {
    void onChatEditorSend("", []);
    return;
  }
  chatEditorRef.value?.send();
}

async function onChatEditorSend(content: string, editorAttachments: Attachment[]) {
  if (!canSend.value) return;
  const allAttachments = [
    ...pendingAttachments.value,
    ...editorAttachments,
  ];
  const refPrefix = props.taskId != null ? codeServerStore.serializeRefs(props.taskId) : "";
  const finalContent = [refPrefix, content.trim()].filter(Boolean).join("\n\n");
  inputText.value = "";
  pendingAttachments.value = [];
  if (props.taskId != null) {
    codeServerStore.clearRefs(props.taskId);
  }
  emit("send", finalContent, allAttachments);
}

function formatCodeRefLabel(ref: CodeRef): string {
  const file = ref.file.split("/").pop() ?? ref.file;
  return `${file} L${ref.startLine}`;
}

function removeCodeRef(index: number) {
  if (props.taskId == null) return;
  codeServerStore.removeRef(props.taskId, index);
}

// ─── File attachments (task mode) ─────────────────────────────────────────────

function readAsBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function inferMediaType(filename: string, reportedType: string): string {
  if (reportedType && reportedType !== "application/octet-stream") return reportedType;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json",
    js: "text/javascript", ts: "text/typescript", py: "text/x-python",
    html: "text/html", css: "text/css", csv: "text/csv",
    xml: "text/xml", yaml: "text/yaml", yml: "text/yaml",
    sh: "text/x-shellscript", pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif", webp: "image/webp",
  };
  return map[ext] ?? reportedType ?? "application/octet-stream";
}

async function addAttachment(file: File | Blob, label: string, mediaType: string) {
  if (pendingAttachments.value.length >= 3) {
    toast.add({ severity: "warn", summary: "Too many attachments", detail: "Maximum 3 attachments per message", life: 4000 });
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    toast.add({ severity: "warn", summary: "File too large", detail: "Attachments must be under 5 MB", life: 4000 });
    return;
  }
  const data = await readAsBase64(file);
  pendingAttachments.value.push({ label, mediaType, data });
}

async function onPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file") {
      event.preventDefault();
      const blob = item.getAsFile();
      if (blob) {
        const inferredType = inferMediaType("pasted-file", item.type || "");
        const ext = inferredType.split("/")[1] ?? "bin";
        await addAttachment(blob, `pasted-file.${ext}`, inferredType);
      }
      break;
    }
  }
}

async function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  for (const file of files) {
    await addAttachment(file, file.name, inferMediaType(file.name, file.type));
  }
  input.value = "";
}

// ─── MCP config editor ────────────────────────────────────────────────────────

async function onMcpEditConfig() {
  try {
    const result = await api("mcp.getConfig", {});
    mcpConfigContent.value = result.content;
    mcpEditorVisible.value = true;
  } catch (err) {
    console.error("Failed to load mcp config", err);
  }
}

async function onMcpConfigSave(content: string) {
  await api("mcp.saveConfig", { content });
  mcpEditorVisible.value = false;
}

async function loadMcpStatus() {
  if (props.taskId == null && props.sessionId == null) {
    mcpStatuses.value = [];
    return;
  }
  try {
    mcpStatuses.value = await api("mcp.getStatus", {});
  } catch (err) {
    console.error("Failed to load MCP status", err);
    mcpStatuses.value = [];
  }
}

watch(
  () => [props.taskId ?? null, props.sessionId ?? null],
  () => {
    void loadMcpStatus();
  },
  { immediate: true },
);

// Expose focus for parent components
defineExpose({ focus: () => chatEditorRef.value?.focus() });
</script>

<style scoped>
.conv-input {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-top: 1px solid var(--p-content-border-color);
}

.conv-input__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 2px 4px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  padding: 2px 8px;
}

.attachment-chip__remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  padding: 0;
  line-height: 1;
}

.conv-input__row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  width: 100%;
}

.conv-input__row :deep(.chat-editor) {
  flex: 1;
  min-width: 0;
}

.conv-input__model-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.input-model-select {
  min-width: 120px;
  max-width: 220px;
  font-size: 0.8rem;
}

.model-select__value {
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-select__option {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.model-select__option-title { font-size: 0.85rem; font-weight: 500; }
.model-select__option-description { font-size: 0.7rem; color: var(--p-text-muted-color); }
.model-select__option-id { font-size: 0.68rem; color: var(--p-text-muted-color); font-family: monospace; }

.model-empty-state {
  display: flex;
  align-items: center;
  gap: 4px;
}

.model-empty-label {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
}

.model-select-footer {
  padding: 4px;
  border-top: 1px solid var(--p-content-border-color);
}

/* Context ring */
.context-ring-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.context-ring__track { stroke: var(--p-content-border-color, #334155); }
.context-ring__label {
  fill: var(--p-text-color, #e2e8f0);
  font-weight: 600;
  font-family: sans-serif;
}

/* Shell auto-approve */
.shell-autoapprove-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.shell-autoapprove-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}
</style>
