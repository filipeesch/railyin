<template>
  <Popover ref="popoverRef">
    <div class="mcp-tools-popover">
      <div class="mcp-tools-popover__header">
        <span class="mcp-tools-popover__title">MCP Tools</span>
        <Button
          v-tooltip="'Reload all'"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          text
          rounded
          :loading="reloading"
          @click="reloadAll"
        />
      </div>

      <div v-if="servers.length === 0" class="mcp-tools-popover__empty">
        No MCP servers configured.<br>
        <small>Click "Edit mcp.json" below to get started.</small>
      </div>

      <div v-for="server in servers" :key="server.name" class="mcp-tools-popover__server">
        <div class="mcp-tools-popover__server-header">
          <span class="mcp-tools-popover__server-dot" :class="`mcp-tools-popover__server-dot--${server.state}`" />
          <span class="mcp-tools-popover__server-name">{{ server.name }}</span>
          <span class="mcp-tools-popover__server-count">{{ server.tools.length }} tools</span>
          <Button
            v-tooltip="'Reload server'"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            text
            rounded
            class="mcp-tools-popover__server-reload"
            @click="reloadServer(server.name)"
          />
        </div>

        <div v-if="server.error" class="mcp-tools-popover__server-error">
          {{ server.error }}
        </div>

        <div v-if="server.state === 'running'" class="mcp-tools-popover__tools">
          <div
            v-for="tool in server.tools"
            :key="tool.qualifiedName"
            class="mcp-tools-popover__tool"
          >
            <Checkbox
              :model-value="isToolEnabled(server.name, tool.name)"
              :binary="true"
              @update:model-value="(val: boolean) => toggleTool(server.name, tool.name, val)"
            />
            <span class="mcp-tools-popover__tool-name" :title="tool.description">{{ tool.name }}</span>
          </div>
        </div>
      </div>

      <div class="mcp-tools-popover__footer">
        <Button
          label="Edit mcp.json"
          icon="pi pi-pencil"
          size="small"
          severity="secondary"
          text
          @click="onEditConfig"
        />
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Popover from "primevue/popover";
import Checkbox from "primevue/checkbox";
import Button from "primevue/button";
import { api } from "../rpc";
import type { McpServerStatus, Task } from "@shared/rpc-types";

const props = defineProps<{
  taskId: number;
  enabledMcpTools: string[] | null;
}>();

const emit = defineEmits<{
  "edit-config": [];
  "tools-changed": [task: Task];
}>();

const popoverRef = ref<InstanceType<typeof Popover> | null>(null);
const servers = ref<McpServerStatus[]>([]);
const reloading = ref(false);

// ─── Public API ───────────────────────────────────────────────────────────────

function toggle(event: MouseEvent) {
  popoverRef.value?.toggle(event);
  loadStatus();
}

defineExpose({ toggle });

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadStatus() {
  try {
    servers.value = await api("mcp.getStatus", {});
  } catch (err) {
    console.error("[McpToolsPopover] Failed to load status", err);
  }
}

// ─── Tool enable/disable ──────────────────────────────────────────────────────

function isToolEnabled(serverName: string, toolName: string): boolean {
  if (props.enabledMcpTools === null) return true;
  return props.enabledMcpTools.includes(`${serverName}:${toolName}`);
}

async function toggleTool(serverName: string, toolName: string, enabled: boolean) {
  const key = `${serverName}:${toolName}`;
  let current = props.enabledMcpTools;

  if (current === null) {
    const allKeys = servers.value.flatMap(s => s.tools.map(t => `${s.name}:${t.name}`));
    current = allKeys;
  }

  let next: string[] | null;
  if (enabled) {
    next = [...new Set([...current, key])];
  } else {
    next = current.filter(k => k !== key);
  }

  const allKeys = servers.value.flatMap(s => s.tools.map(t => `${s.name}:${t.name}`));
  if (next.length === allKeys.length && allKeys.every(k => next!.includes(k))) {
    next = null;
  }

  try {
    const updated = await api("mcp.setTaskTools", { taskId: props.taskId, enabledTools: next });
    emit("tools-changed", updated);
  } catch (err) {
    console.error("[McpToolsPopover] Failed to update tools", err);
  }
}

// ─── Reload ───────────────────────────────────────────────────────────────────

async function reloadAll() {
  reloading.value = true;
  try {
    servers.value = await api("mcp.reload", {});
  } finally {
    reloading.value = false;
  }
}

async function reloadServer(name: string) {
  try {
    servers.value = await api("mcp.reload", { serverName: name });
  } catch (err) {
    console.error("[McpToolsPopover] Failed to reload", name, err);
  }
}

// ─── Edit config ──────────────────────────────────────────────────────────────

function onEditConfig() {
  emit("edit-config");
}
</script>

<style scoped>
.mcp-tools-popover {
  min-width: 260px;
  max-width: 340px;
}

.mcp-tools-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem 0.25rem;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  margin-bottom: 0.25rem;
}

.mcp-tools-popover__title {
  font-weight: 600;
  font-size: 0.85rem;
}

.mcp-tools-popover__empty {
  padding: 0.75rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
  text-align: center;
}

.mcp-tools-popover__server {
  padding: 0.4rem 0.75rem;
}

.mcp-tools-popover__server + .mcp-tools-popover__server {
  border-top: 1px solid var(--p-surface-100, #f1f5f9);
}

.mcp-tools-popover__server-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}

.mcp-tools-popover__server-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mcp-tools-popover__server-dot--running {
  background: var(--p-green-500, #22c55e);
}

.mcp-tools-popover__server-dot--error {
  background: var(--p-red-500, #ef4444);
}

.mcp-tools-popover__server-dot--starting {
  background: var(--p-yellow-500, #eab308);
}

.mcp-tools-popover__server-dot--idle,
.mcp-tools-popover__server-dot--disabled {
  background: var(--p-surface-400, #94a3b8);
}

.mcp-tools-popover__server-name {
  font-size: 0.82rem;
  font-weight: 600;
  flex: 1;
}

.mcp-tools-popover__server-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #64748b);
}

.mcp-tools-popover__server-reload {
  margin-left: auto;
}

.mcp-tools-popover__server-error {
  font-size: 0.75rem;
  color: var(--p-red-500, #ef4444);
  padding: 0.25rem 0;
}

.mcp-tools-popover__tools {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-left: 0.5rem;
  padding-bottom: 0.25rem;
}

.mcp-tools-popover__tool {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mcp-tools-popover__tool-name {
  font-size: 0.78rem;
  cursor: default;
}

.mcp-tools-popover__footer {
  border-top: 1px solid var(--p-surface-200, #e2e8f0);
  padding: 0.4rem 0.5rem 0.25rem;
  margin-top: 0.25rem;
}
</style>
