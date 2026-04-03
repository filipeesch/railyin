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
import { onStreamToken, onStreamError, onTaskUpdated } from "./rpc";

const router = useRouter();
const toast = useToast();
const workspaceStore = useWorkspaceStore();
const boardStore = useBoardStore();
const taskStore = useTaskStore();

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

  onTaskUpdated((task) => {
    taskStore.onTaskUpdated(task);
  });

  // Boot: load workspace config
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
</style>
