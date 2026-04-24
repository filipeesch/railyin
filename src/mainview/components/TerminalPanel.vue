<template>
  <div class="terminal-panel">
    <!-- Resize handle -->
    <div class="terminal-panel__handle" @mousedown="startResize" />

    <!-- Content -->
    <div class="terminal-panel__content">
      <!-- Terminal output area -->
      <div class="terminal-panel__output">
        <PtyTerminal
          v-if="terminalStore.activeSessionId"
          :key="terminalStore.activeSessionId"
          :session-id="terminalStore.activeSessionId"
        />
        <div v-else class="terminal-panel__empty">
          No active session. Click <strong>⊕ New terminal</strong> to start one.
        </div>
      </div>

      <div
        class="terminal-panel__session-handle"
        data-testid="terminal-session-resize-handle"
        role="separator"
        aria-orientation="vertical"
        @mousedown.stop.prevent="startSessionResize"
      ></div>

      <!-- Session list sidebar -->
      <TerminalSessionList />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import PtyTerminal from "./PtyTerminal.vue";
import TerminalSessionList from "./TerminalSessionList.vue";
import { useTerminalStore } from "../stores/terminal";

const terminalStore = useTerminalStore();

let startY = 0;
let startHeight = 0;
let startX = 0;
let startWidth = 0;

function startResize(e: MouseEvent) {
  startY = e.clientY;
  startHeight = terminalStore.panelHeight;
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", stopResize);
  e.preventDefault();
}

function onMouseMove(e: MouseEvent) {
  const delta = startY - e.clientY;
  terminalStore.setHeight(startHeight + delta);
}

function startSessionResize(e: MouseEvent) {
  startX = e.clientX;
  startWidth = terminalStore.sessionPaneWidth;
  window.addEventListener("mousemove", onSessionMouseMove);
  window.addEventListener("mouseup", stopSessionResize);
}

function onSessionMouseMove(e: MouseEvent) {
  const delta = startX - e.clientX;
  terminalStore.setSessionPaneWidth(startWidth + delta);
}

function stopResize() {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", stopResize);
}

function stopSessionResize() {
  window.removeEventListener("mousemove", onSessionMouseMove);
  window.removeEventListener("mouseup", stopSessionResize);
}

onUnmounted(() => {
  window.removeEventListener("mousemove", onMouseMove);
  window.removeEventListener("mouseup", stopResize);
  window.removeEventListener("mousemove", onSessionMouseMove);
  window.removeEventListener("mouseup", stopSessionResize);
});
</script>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  flex-shrink: 0;
  overflow: hidden;
}

.terminal-panel__handle {
  height: 4px;
  background: transparent;
  cursor: ns-resize;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  transition: background 0.15s;
}

.terminal-panel__handle:hover {
  background: rgba(255, 255, 255, 0.15);
}

.terminal-panel__content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.terminal-panel__output {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  position: relative; /* needed so absolute child is bounded */
}

.terminal-panel__session-handle {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.08);
  transition: background 0.15s, box-shadow 0.15s;
}

.terminal-panel__session-handle:hover,
.terminal-panel__session-handle:active {
  background: rgba(86, 156, 214, 0.2);
  box-shadow: inset 1px 0 0 rgba(86, 156, 214, 0.55);
}

.terminal-panel__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 13px;
  font-family: Menlo, Monaco, "Courier New", monospace;
}
</style>
