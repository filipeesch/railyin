<template>
  <!-- Resize handle sits outside the Drawer so it can overlap its left edge -->
  <div
    v-if="drawerStore.mode !== null"
    class="conv-drawer-resize-handle"
    :style="{ right: drawerStore.width + 'px' }"
    @mousedown.stop.prevent="startResize"
    @click.stop
  />

  <Drawer
    v-model:visible="open"
    position="right"
    :pt="{ root: { style: { width: drawerStore.width + 'px' } } }"
    :modal="false"
    :dismissable="false"
    :show-close-icon="false"
    @hide="onHide"
  >
    <!-- Suppress PrimeVue's default header completely -->
    <template #header></template>

    <TaskChatView
      v-if="drawerStore.mode === 'task' && drawerStore.taskId != null"
      :task-id="drawerStore.taskId"
    />
    <SessionChatView
      v-else-if="drawerStore.mode === 'session' && drawerStore.sessionId != null"
      :session-id="drawerStore.sessionId"
    />
  </Drawer>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import Drawer from "primevue/drawer";
import TaskChatView from "./TaskChatView.vue";
import SessionChatView from "./SessionChatView.vue";
import { useDrawerStore } from "../stores/drawer";
import { useTaskStore } from "../stores/task";
import { useChatStore } from "../stores/chat";

const drawerStore = useDrawerStore();
const taskStore = useTaskStore();
const chatStore = useChatStore();

const open = computed({
  get: () => drawerStore.mode !== null,
  set: (v) => {
    if (!v) {
      if (drawerStore.mode === "task") taskStore.closeTask();
      else if (drawerStore.mode === "session") chatStore.closeSession();
      drawerStore.close();
    }
  },
});

function onHide() {
  if (drawerStore.mode === "task") taskStore.closeTask();
  else if (drawerStore.mode === "session") chatStore.closeSession();
  drawerStore.close();
}

// ─── Resize logic ─────────────────────────────────────────────────────────────

function startResize(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = drawerStore.width;

  function onMove(ev: MouseEvent) {
    drawerStore.setWidth(startWidth + (startX - ev.clientX));
  }
  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// ─── Outside-click guard ─────────────────────────────────────────────────────
// PrimeVue teleports overlays (Select, Dialog, Popover) to document.body.
// We implement our own dismissable logic instead of PrimeVue's built-in one.

function handleOutsideClick(e: MouseEvent) {
  if (!open.value) return;
  const target = e.target as Element | null;
  // Skip clicks inside teleported PrimeVue overlay panels
  if (target?.closest(
    ".p-select-overlay, .p-dialog, .p-datepicker, .p-autocomplete-overlay, " +
    ".p-multiselect-overlay, .todo-overlay-backdrop, .task-overlay, " +
    ".p-popover, .file-editor-overlay"
  )) return;
  // Skip if the click is inside the drawer panel itself
  const drawerPanel = document.querySelector(".p-drawer");
  if (drawerPanel && drawerPanel.contains(e.target as Node)) return;
  // Click was outside — close the drawer
  open.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", handleOutsideClick);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", handleOutsideClick);
});
</script>

<style scoped>
.conv-drawer-resize-handle {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1001;
  background: transparent;
  transition: background 0.15s;
}

.conv-drawer-resize-handle:hover,
.conv-drawer-resize-handle:active {
  background: var(--p-primary-color, #6366f1);
  opacity: 0.35;
}
</style>

<!-- Strip PrimeVue Drawer default chrome so our views own the full layout -->
<style>
/* Drawer panel: full-height flex column, covers entire viewport */
.p-drawer-right.p-drawer {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
}

/* Hide PrimeVue's built-in header (we use our own inside the slot) */
.p-drawer-right .p-drawer-header {
  display: none !important;
  padding: 0 !important;
  min-height: 0 !important;
}

/* Content fills remaining height, zero padding, column flex */
.p-drawer-right .p-drawer-content {
  flex: 1 1 0 !important;
  padding: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  min-height: 0 !important;
}

/* The drawer mask must not intercept pointer events — we use modal=false and our own outside-click dismissal.
   Re-enable on the actual drawer panel so it remains interactive. */
.p-drawer-mask {
  pointer-events: none !important;
}
.p-drawer-mask .p-drawer {
  pointer-events: auto !important;
}
</style>
