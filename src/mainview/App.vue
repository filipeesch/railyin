<template>
  <div class="railyn-app">
    <Toast position="top-right" />
    <RouterView />
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";
import Toast from "primevue/toast";
import { useWorkspaceStore } from "./stores/workspace";
import { useBoardStore } from "./stores/board";
import { useTaskStore } from "./stores/task";
import { onStreamError, onStreamEventMessage, onTaskUpdated, onNewMessage, onCodeRef, onChatSessionUpdated, onChatSessionCreated } from "./rpc";
import { getTaskActivityToast } from "./task-activity";
import { useCodeServerStore } from "./stores/codeServer";
import { useChatStore } from "./stores/chat";
import { useDrawerStore } from "./stores/drawer";
import { useConversationStore } from "./stores/conversation";

const router = useRouter();
const toast = useToast();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const taskStore = useTaskStore();
const codeServerStore = useCodeServerStore();
const chatStore = useChatStore();
const drawerStore = useDrawerStore();
const conversationStore = useConversationStore();

function toastForActivity(activity: ReturnType<typeof taskStore.onTaskUpdated>) {
  if (!activity) return;
  // Suppress toast for the task currently visible in the conversation drawer
  if (drawerStore.mode === "task" && activity.task.id === drawerStore.taskId) return;
  const board = boardStore.boards.find((entry) => entry.id === activity.task.boardId);
  const workspace = workspaceStore.workspaces.find((entry) => entry.key === board?.workspaceKey);
  const toastPayload = getTaskActivityToast(activity, workspace?.name ?? "Workspace");
  if (toastPayload) toast.add(toastPayload);
}

onMounted(async () => {
  // Register IPC push handlers from Bun
  onStreamError((payload) => {
    // Surface config errors (taskId === -1 is a sentinel)
    if (payload.taskId === -1) {
      toast.add({ severity: "error", summary: "Config Error", detail: payload.error, life: 0 });
      router.push("/setup");
      return;
    }
    conversationStore.onStreamError(payload);
    if (payload.taskId != null) {
      toast.add({ severity: "warn", summary: "Execution failed", detail: payload.error, life: 6000 });
    }
  });

  onStreamEventMessage((event) => {
    conversationStore.onStreamEvent(event);
  });

  onTaskUpdated((task) => {
    toastForActivity(taskStore.onTaskUpdated(task));
  });

  onNewMessage((message) => {
    conversationStore.onNewMessage(message);
  });

  onCodeRef((ref) => {
    codeServerStore.addRef(ref);
  });

  onChatSessionUpdated((session) => chatStore.onChatSessionUpdated(session));
  onChatSessionCreated((session) => chatStore.onChatSessionUpdated(session));

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

  // Load chat sessions (workspace-scoped, not tied to a board)
  chatStore.loadSessions(workspaceStore.activeWorkspaceKey ?? undefined).catch(console.error);

  // Load enabled models once now, then re-load on workspace switch
  workspaceStore.loadEnabledModels(workspaceStore.activeWorkspaceKey ?? undefined).catch(console.error);
});

// Re-load models whenever the active workspace changes
watch(
  () => workspaceStore.activeWorkspaceKey,
  (key) => {
    if (key) workspaceStore.loadEnabledModels(key).catch(console.error);
  },
);
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

html.dark-mode,
html.dark-mode body,
html.dark-mode #app,
html.dark-mode .railyn-app {
  background: var(--p-surface-950);
}
</style>
