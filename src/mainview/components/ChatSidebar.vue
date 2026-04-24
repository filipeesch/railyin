<template>
  <div class="chat-sidebar" :style="{ width: sidebarWidth + 'px' }">
    <!-- Resize handle on the left edge -->
    <div class="chat-sidebar__resize-handle" @mousedown.stop.prevent="startResize" />

    <div class="chat-sidebar__header">
      <span class="chat-sidebar__title">Chat Sessions</span>
      <Button
        icon="pi pi-plus"
        text
        rounded
        size="small"
        aria-label="New chat session"
        @click="createNewSession"
      />
    </div>

    <div class="chat-sidebar__list">
      <div
        v-for="session in activeSessions"
        :key="session.id"
        class="session-item"
        :class="{
          'is-active': chatStore.activeChatSessionId === session.id,
          'has-unread': chatStore.hasUnread(session.id),
        }"
        :data-session-id="session.id"
        @click="openSession(session)"
      >
        <!-- Status dot -->
        <span
          class="session-item__status-dot"
          :class="`status-dot--${session.status}`"
          :title="statusLabel(session.status)"
        />

        <div class="session-item__content">
          <template v-if="renamingId === session.id">
            <InputText
              v-model="renameValue"
              size="small"
              class="session-item__rename-input"
              @keydown.enter.exact.prevent="saveRename(session.id)"
              @keydown.esc="cancelRename"
              @click.stop
            />
          </template>
          <template v-else>
            <span class="session-item__title">{{ session.title }}</span>
          </template>
          <span class="session-item__time">{{ relativeTime(session.lastActivityAt) }}</span>
        </div>

        <!-- Unread dot -->
        <span
          v-if="chatStore.hasUnread(session.id)"
          class="session-item__unread-dot"
          aria-label="Unread activity"
        />

        <!-- Action buttons (visible on hover) -->
        <div class="session-item__actions" @click.stop>
          <Button
            icon="pi pi-pencil"
            text
            rounded
            size="small"
            class="session-item__action-btn"
            aria-label="Rename"
            @click="startRename(session)"
          />
          <Button
            icon="pi pi-inbox"
            text
            rounded
            size="small"
            class="session-item__action-btn"
            severity="secondary"
            aria-label="Archive"
            @click="archiveSession(session.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { useChatStore } from "../stores/chat";
import { useWorkspaceStore } from "../stores/workspace";
import type { ChatSession } from "@shared/rpc-types";

const chatStore = useChatStore();
const workspaceStore = useWorkspaceStore();

// ─── Sidebar width (resizable, persisted) ─────────────────────────────────────

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const STORAGE_KEY = "chat-sidebar-width";

function loadWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  const n = stored ? parseInt(stored, 10) : NaN;
  return isNaN(n) ? 220 : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
}

const sidebarWidth = ref(loadWidth());

function startResize(e: MouseEvent) {
  const startX = e.clientX;
  const startWidth = sidebarWidth.value;

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + delta));
  }
  function onUp() {
    localStorage.setItem(STORAGE_KEY, String(sidebarWidth.value));
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// ─── Expose width so parent can offset board layout ───────────────────────────
defineExpose({ sidebarWidth });

const renamingId = ref<number | null>(null);
const renameValue = ref("");

const activeSessions = computed(() =>
  chatStore.sessions.filter(s => s.status !== 'archived')
);

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    idle: "Idle",
    running: "Running",
    waiting_user: "Awaiting input",
    archived: "Archived",
  };
  return map[status] ?? status;
}

async function createNewSession() {
  const session = await chatStore.createSession(workspaceStore.activeWorkspaceKey ?? undefined);
  await chatStore.selectSession(session.id);
}

function openSession(session: ChatSession) {
  chatStore.selectSession(session.id);
}

function archiveSession(sessionId: number) {
  chatStore.archiveSession(sessionId);
}

function startRename(session: ChatSession) {
  renamingId.value = session.id;
  renameValue.value = session.title;
}

async function saveRename(sessionId: number) {
  if (!renameValue.value.trim()) {
    cancelRename();
    return;
  }
  await chatStore.renameSession(sessionId, renameValue.value.trim());
  renamingId.value = null;
}

function cancelRename() {
  renamingId.value = null;
  renameValue.value = "";
}
</script>

<style scoped>
.chat-sidebar {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: var(--board-header-height, 65px);
  right: 0;
  bottom: 0;
  /* width is bound via :style — no hardcoded value here */
  border-left: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
  overflow: hidden;
  z-index: 900;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
}

.chat-sidebar__resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1;
  background: transparent;
  transition: background 0.15s;
}

.chat-sidebar__resize-handle:hover,
.chat-sidebar__resize-handle:active {
  background: var(--p-primary-color, #6366f1);
  opacity: 0.35;
}

.chat-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.chat-sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  position: relative;
}

.session-item:hover,
.session-item.is-active {
  background: var(--p-highlight-background, var(--p-surface-100));
}

.session-item.is-active .session-item__title {
  font-weight: 600;
}

.session-item__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.session-item__status-dot.status-dot--idle {
  background: var(--p-text-muted-color);
}

.session-item__status-dot.status-dot--running {
  background: var(--p-blue-500, #3b82f6);
}

.session-item__status-dot.status-dot--waiting_user {
  background: var(--p-yellow-500, #eab308);
}

.session-item__status-dot.status-dot--archived {
  background: var(--p-text-muted-color);
  opacity: 0.4;
}

.session-item__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-item__title {
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item__time {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.session-item__unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--p-primary-color);
  flex-shrink: 0;
}

.session-item__actions {
  display: none;
  gap: 2px;
}

.session-item:hover .session-item__actions {
  display: flex;
}

.session-item__rename-input {
  font-size: 0.85rem;
  width: 100%;
}
</style>
