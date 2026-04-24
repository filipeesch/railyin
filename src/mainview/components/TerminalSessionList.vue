<template>
  <div
    class="session-list"
    :style="{
      width: terminalStore.sessionPaneWidth + 'px',
      minWidth: terminalStore.sessionPaneWidth + 'px',
      maxWidth: terminalStore.sessionPaneWidth + 'px',
    }"
  >
    <div class="session-list__header">TERMINAL</div>

    <div class="session-list__items">
      <div
        v-for="session in terminalStore.sessions"
        :key="session.sessionId"
        class="session-item"
        :class="{ 'is-active': session.sessionId === terminalStore.activeSessionId }"
        @click="terminalStore.setActive(session.sessionId)"
      >
        <div class="session-item__info">
          <span class="session-item__label">{{ session.label }}</span>
          <span class="session-item__cwd" :title="session.cwd">{{ truncateCwd(session.cwd) }}</span>
        </div>
        <button
          class="session-item__kill"
          title="Close session"
          @click.stop="killSession(session.sessionId)"
        >
          ×
        </button>
      </div>
    </div>

    <button class="session-list__new" @click="createShellSession">
      <span>⊕</span> New terminal
    </button>
  </div>
</template>

<script setup lang="ts">
import { useTerminalStore } from "../stores/terminal";
import { useWorkspaceStore } from "../stores/workspace";
import { api } from "../rpc";

const terminalStore = useTerminalStore();
const workspaceStore = useWorkspaceStore();

function truncateCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return cwd;
  return "…/" + parts.slice(-2).join("/");
}

async function createShellSession() {
  const cwd = workspaceStore.config?.worktreeBasePath ?? ".";
  const result = await api("launch.shell", { cwd });
  terminalStore.addSession(result.sessionId, "bash", cwd);
}

async function killSession(sessionId: string) {
  await api("launch.kill", { sessionId });
  terminalStore.removeSession(sessionId);
}
</script>

<style scoped>
.session-list {
  display: flex;
  flex-direction: column;
  background: #252526;
  overflow: hidden;
}

.session-list__header {
  padding: 6px 10px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  flex-shrink: 0;
}

.session-list__items {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.24) rgba(255, 255, 255, 0.04);
}

.session-list__items::-webkit-scrollbar {
  width: 10px;
}

.session-list__items::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.04);
}

.session-list__items::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: content-box;
}

.session-list__items::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.34);
  background-clip: content-box;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  gap: 4px;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.07);
}

.session-item.is-active {
  background: rgba(255, 255, 255, 0.12);
}

.session-item__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-item__label {
  font-size: 12px;
  color: #d4d4d4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item__cwd {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item__kill {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
  opacity: 0;
  flex-shrink: 0;
}

.session-item:hover .session-item__kill {
  opacity: 1;
}

.session-item__kill:hover {
  color: #f48771;
}

.session-list__new {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: none;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  cursor: pointer;
  width: 100%;
  text-align: left;
  flex-shrink: 0;
}

.session-list__new:hover {
  color: #d4d4d4;
  background: rgba(255, 255, 255, 0.05);
}
</style>
