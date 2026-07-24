<template>
  <Popover ref="popoverRef" @hide="onHide">
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

      <div class="mcp-tools-popover__body">
        <div v-if="servers.length === 0" class="mcp-tools-popover__empty">
          No MCP servers configured.<br>
          <small>Click "Edit mcp.json" below to get started.</small>
        </div>

        <div v-for="server in servers" :key="server.name" class="mcp-tools-popover__server">
          <!-- Server row (collapsible header) -->
          <div class="mcp-tools-popover__server-row">
            <button class="mcp-tools-popover__chevron" @click="toggleExpand(server.name)">
              <i class="pi pi-chevron-right" :class="{ 'is-expanded': expanded.has(server.name) }" />
            </button>
            <Checkbox
              :model-value="serverCheckState(server) === 'all'"
              :binary="true"
              :indeterminate="serverCheckState(server) === 'some'"
              @update:model-value="(val: boolean) => toggleServer(server, val)"
            />
            <span class="mcp-tools-popover__server-dot" :class="`mcp-tools-popover__server-dot--${server.state}`" />
            <span class="mcp-tools-popover__server-name" @click="toggleExpand(server.name)">{{ server.name }}</span>
            <span class="mcp-tools-popover__server-count">{{ server.tools.length }}</span>
            <Button
              v-if="server.state === 'auth_required'"
              v-tooltip="'Sign in'"
              label="Sign in"
              size="small"
              severity="warn"
              text
              class="mcp-tools-popover__server-signin"
              @click="authorizeServer(server.name)"
            />
            <Button
              v-else
              v-tooltip="'Reload'"
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

          <!-- Tool children (shown when expanded) -->
          <div v-if="expanded.has(server.name) && server.tools.length > 0" class="mcp-tools-popover__tools">
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
      </div>

      <div class="mcp-tools-popover__footer">
        <Button
          label="Edit global mcp.json"
          icon="pi pi-pencil"
          size="small"
          severity="secondary"
          text
          @click="onEditGlobalConfig"
        />
        <Button
          v-if="props.projectKey"
          label="Edit project mcp.json"
          icon="pi pi-pencil"
          size="small"
          severity="secondary"
          text
          @click="onEditProjectConfig"
        />
      </div>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue";
import Popover from "primevue/popover";
import Checkbox from "primevue/checkbox";
import Button from "primevue/button";
import { api } from "../rpc";
import type { ChatSession, McpServerStatus, Task } from "@shared/rpc-types";

const props = defineProps<{
  taskId?: number | null;
  sessionId?: number | null;
  enabledMcpTools: string[] | null;
  projectKey?: string | null;
  workspaceKey?: string | null;
}>();

const emit = defineEmits<{
  "edit-global-config": [];
  "edit-project-config": [];
  "tools-changed": [target: Task | ChatSession];
}>();

const popoverRef = ref<InstanceType<typeof Popover> | null>(null);
const servers = ref<McpServerStatus[]>([]);
const reloading = ref(false);
const expanded = ref(new Set<string>());
const isOpen = ref(false);
const POLL_INTERVAL_MS = 3000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Local shadow of enabledMcpTools — updated immediately on click for instant UX
const localEnabled = ref<string[] | null>(props.enabledMcpTools);
watch(() => props.enabledMcpTools, (val) => { localEnabled.value = val; });

// ─── Public API ───────────────────────────────────────────────────────────────

function toggle(event: MouseEvent) {
  popoverRef.value?.toggle(event);
  isOpen.value = true;
  loadStatus();
}

function getContainer(): HTMLElement | null {
  return (popoverRef.value as unknown as { $el?: HTMLElement })?.$el ?? null;
}

defineExpose({ toggle, getContainer });

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadStatus() {
  try {
    servers.value = await api("mcp.getStatus", {});
  } catch (err) {
    console.error("[McpToolsPopover] Failed to load status", err);
  }
  syncPolling();
}

// ─── Poll while any server needs sign-in ───────────────────────────────────────
// Backend has no push notification for OAuth callback completion, so while the
// popover is open and at least one server is `auth_required`, poll getStatus
// to pick up the transition once the user finishes the out-of-band browser flow.

function syncPolling() {
  const needsPolling = isOpen.value && servers.value.some(s => s.state === "auth_required");
  if (needsPolling && pollTimer === null) {
    pollTimer = setInterval(loadStatus, POLL_INTERVAL_MS);
  } else if (!needsPolling && pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

onUnmounted(stopPolling);

// ─── Expand / collapse ────────────────────────────────────────────────────────

async function toggleExpand(name: string) {
  const next = new Set(expanded.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  expanded.value = next;
  // Re-align after DOM updates so the popover doesn't overflow the viewport
  await nextTick();
  (popoverRef.value as unknown as { alignOverlay?: () => void })?.alignOverlay?.();
}

function onHide() {
  expanded.value = new Set();
  isOpen.value = false;
  stopPolling();
}

// ─── Server-level checkbox state ──────────────────────────────────────────────

function serverCheckState(server: McpServerStatus): "all" | "some" | "none" {
  if (server.tools.length === 0) return "none";
  const enabled = server.tools.filter(t => isToolEnabled(server.name, t.name));
  if (enabled.length === server.tools.length) return "all";
  if (enabled.length === 0) return "none";
  return "some";
}

async function toggleServer(server: McpServerStatus, checked: boolean) {
  const current = localEnabled.value ?? [];
  const serverKeys = server.tools.map(t => `${server.name}:${t.name}`);
  let next: string[];
  if (checked) {
    next = [...new Set([...current, ...serverKeys])];
  } else {
    next = current.filter(k => !serverKeys.includes(k));
  }
  // Update local state immediately for instant visual feedback
  localEnabled.value = next;
  try {
    const updated = await saveTools(next);
    emit("tools-changed", updated);
  } catch (err) {
    console.error("[McpToolsPopover] Failed to update server tools", err);
    localEnabled.value = props.enabledMcpTools; // revert on error
  }
}

// ─── Tool enable/disable ──────────────────────────────────────────────────────

function isToolEnabled(serverName: string, toolName: string): boolean {
  if (localEnabled.value === null) return false;
  return localEnabled.value.includes(`${serverName}:${toolName}`);
}

async function toggleTool(serverName: string, toolName: string, enabled: boolean) {
  const key = `${serverName}:${toolName}`;
  const current = localEnabled.value ?? [];

  let next: string[];
  if (enabled) {
    next = [...new Set([...current, key])];
  } else {
    next = current.filter(k => k !== key);
  }

  // Update local state immediately for instant visual feedback
  localEnabled.value = next;
  try {
    const updated = await saveTools(next);
    emit("tools-changed", updated);
  } catch (err) {
    console.error("[McpToolsPopover] Failed to update tools", err);
    localEnabled.value = props.enabledMcpTools; // revert on error
  }
}

// ─── Reload ───────────────────────────────────────────────────────────────────

async function reloadAll() {
  reloading.value = true;
  try {
    servers.value = await api("mcp.reload", {});
    syncPolling();
  } finally {
    reloading.value = false;
  }
}

async function reloadServer(name: string) {
  try {
    servers.value = await api("mcp.reload", { serverName: name });
    syncPolling();
  } catch (err) {
    console.error("[McpToolsPopover] Failed to reload", name, err);
  }
}

async function authorizeServer(name: string) {
  try {
    servers.value = await api("mcp.authorize", { serverName: name });
    syncPolling();
  } catch (err) {
    console.error("[McpToolsPopover] Failed to authorize", name, err);
  }
}

// ─── Edit config ──────────────────────────────────────────────────────────────

function onEditGlobalConfig() {
  emit("edit-global-config");
}

function onEditProjectConfig() {
  emit("edit-project-config");
}

function saveTools(enabledTools: string[]): Promise<Task | ChatSession> {
  if (props.taskId != null) {
    return api("mcp.setTaskTools", { taskId: props.taskId, enabledTools });
  }
  if (props.sessionId != null) {
    return api("mcp.setSessionTools", { sessionId: props.sessionId, enabledTools });
  }
  throw new Error("MCP tool scope is not configured");
}
</script>

<style scoped>
.mcp-tools-popover {
  min-width: 260px;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  max-height: min(80vh, 480px);
  overflow: hidden;
}

.mcp-tools-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem 0.25rem;
  border-bottom: 1px solid var(--p-surface-200, #e2e8f0);
  flex-shrink: 0;
}

.mcp-tools-popover__title {
  font-weight: 600;
  font-size: 0.85rem;
}

.mcp-tools-popover__body {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: 0.25rem 0;
}

.mcp-tools-popover__empty {
  padding: 0.75rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, #64748b);
  text-align: center;
}

.mcp-tools-popover__server {
  padding: 0.15rem 0;
}

.mcp-tools-popover__server + .mcp-tools-popover__server {
  border-top: 1px solid var(--p-surface-100, #f1f5f9);
}

.mcp-tools-popover__server-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.5rem 0.3rem 0.25rem;
  cursor: default;
}

.mcp-tools-popover__chevron {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 0.1rem;
  display: flex;
  align-items: center;
  color: var(--p-text-muted-color, #64748b);
}

.mcp-tools-popover__chevron .pi {
  font-size: 0.65rem;
  transition: transform 0.15s ease;
}

.mcp-tools-popover__chevron .pi.is-expanded {
  transform: rotate(90deg);
}

.mcp-tools-popover__server-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mcp-tools-popover__server-dot--running { background: var(--p-green-500, #22c55e); }
.mcp-tools-popover__server-dot--error   { background: var(--p-red-500, #ef4444); }
.mcp-tools-popover__server-dot--starting { background: var(--p-yellow-500, #eab308); }
.mcp-tools-popover__server-dot--idle,
.mcp-tools-popover__server-dot--disabled { background: var(--p-surface-400, #94a3b8); }
.mcp-tools-popover__server-dot--auth_required { background: var(--p-orange-500, #f97316); }

.mcp-tools-popover__server-name {
  font-size: 0.82rem;
  font-weight: 600;
  flex: 1;
  cursor: pointer;
  user-select: none;
}

.mcp-tools-popover__server-count {
  font-size: 0.72rem;
  color: var(--p-text-muted-color, #64748b);
  background: var(--p-surface-100, #f1f5f9);
  border-radius: 999px;
  padding: 0 0.4rem;
  line-height: 1.5;
}

.mcp-tools-popover__server-error {
  font-size: 0.75rem;
  color: var(--p-red-500, #ef4444);
  padding: 0.1rem 0.75rem 0.25rem 2rem;
}

.mcp-tools-popover__tools {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.1rem 0.5rem 0.3rem 2.5rem;
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
  flex-shrink: 0;
}
</style>
