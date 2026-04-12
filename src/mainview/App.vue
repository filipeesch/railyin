<template>
  <div class="railyn-app">
    <Toast position="top-right" />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";
import Toast from "primevue/toast";
import { useWorkspaceStore } from "./stores/workspace";
import { useBoardStore } from "./stores/board";
import { useTaskStore } from "./stores/task";
import { onStreamToken, onStreamError, onStreamEventMessage, onTaskUpdated, onNewMessage } from "./rpc";
import { getTaskActivityToast } from "./task-activity";

const router = useRouter();
const toast = useToast();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const taskStore = useTaskStore();

function toastForActivity(activity: ReturnType<typeof taskStore.onTaskUpdated>) {
  if (!activity) return;
  // Don't toast for the task the user is currently looking at
  if (activity.task.id === taskStore.activeTaskId) return;
  const board = boardStore.boards.find((entry) => entry.id === activity.task.boardId);
  const workspace = workspaceStore.workspaces.find((entry) => entry.id === board?.workspaceId);
  const toastPayload = getTaskActivityToast(activity, workspace?.name ?? "Workspace");
  if (toastPayload) toast.add(toastPayload);
}

onMounted(async () => {
  // Register IPC push handlers from Bun
  onStreamToken((payload) => {
    taskStore.onStreamToken(payload);
  });

  onStreamError((payload) => {
    // Surface config errors (taskId === -1 is a sentinel)
    if (payload.taskId === -1) {
      toast.add({ severity: "error", summary: "Config Error", detail: payload.error, life: 0 });
      router.push("/setup");
      return;
    }
    taskStore.onStreamError(payload);
    toast.add({ severity: "warn", summary: "Execution failed", detail: payload.error, life: 6000 });
  });

  onStreamEventMessage((event) => {
    taskStore.onStreamEvent(event);
  });

  onTaskUpdated((task) => {
    toastForActivity(taskStore.onTaskUpdated(task));
  });

  onNewMessage((message) => {
    taskStore.onNewMessage(message);
  });

  // Boot: load workspace config
  await workspaceStore.loadWorkspaces();
  await workspaceStore.load();

  if (!workspaceStore.isConfigured()) {
    router.push("/setup");
    return;
  }

  // Load boards; redirect to setup if none exist yet
  await boardStore.loadBoards();
  if (boardStore.boards.length === 0) {
    router.push("/setup");
  } else {
    router.push("/board");
  }
});
</script>

<style>
html,
body,
#app,
.railyn-app {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: var(--p-font-family, system-ui, sans-serif);
  background: var(--p-surface-50, #f8fafc);
  color: var(--p-text-color, #1e293b);
}

/* Monaco code-review hunk decorations (applied via deltaDecorations — must be global) */
.accepted-hunk-decoration {
  background: color-mix(in srgb, var(--p-content-background, #ffffff) 92%, #22c55e 8%) !important;
  border-left: 2px solid #22c55e;
}

.rejected-hunk-decoration {
  background: rgba(239, 68, 68, 0.08) !important;
  text-decoration: line-through;
  opacity: 0.6;
}

.monaco-editor .accepted-hunk-inline-decoration,
.monaco-editor .accepted-hunk-inline-decoration.char-insert,
.monaco-editor .accepted-hunk-inline-decoration.char-delete {
  background: transparent !important;
}

.monaco-editor .accepted-hunk-decoration.line-insert,
.monaco-editor .accepted-hunk-decoration.line-delete,
.monaco-editor .accepted-hunk-decoration.char-insert,
.monaco-editor .accepted-hunk-decoration.char-delete {
  background: color-mix(in srgb, var(--p-content-background, #ffffff) 96%, #22c55e 4%) !important;
}

/* Glyph margin comment icon (shown on hover in review mode) */
.line-comment-glyph::before {
  content: "+";
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--p-blue-500, #3b82f6);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

/* ContentWidget shown when a multi-line selection is made in review mode */
.line-comment-widget {
  background: var(--p-blue-500, #3b82f6);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  margin-left: 8px;
}

html.dark-mode,
html.dark-mode body,
html.dark-mode #app,
html.dark-mode .railyn-app {
  background: var(--p-surface-950);
}
</style>
