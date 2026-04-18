import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "../rpc";
import type { WorkspaceConfig, WorkspaceSummary } from "@shared/rpc-types";

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceSummary[]>([]);
  const activeWorkspaceKey = ref<string | null>(null);
  const config = ref<WorkspaceConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadWorkspaces() {
    workspaces.value = await api("workspace.list", {});
    if (!activeWorkspaceKey.value && workspaces.value.length > 0) {
      activeWorkspaceKey.value = workspaces.value[0].key;
    }
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      if (!activeWorkspaceKey.value) {
        await loadWorkspaces();
      }
      const workspaceKey = activeWorkspaceKey.value ?? undefined;
      config.value = await api("workspace.getConfig", {
        workspaceKey,
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function setThinking(enabled: boolean) {
    await api("workspace.setThinking", {
      workspaceKey: activeWorkspaceKey.value ?? undefined,
      enabled,
    });
    // Optimistically update local state so the toggle feels instant
    if (config.value) config.value = { ...config.value, enableThinking: enabled };
  }

  async function selectWorkspace(key: string) {
    activeWorkspaceKey.value = key;
    await load();
  }

  /** Derived: first workflow template from the workspace config (from boards store) */
  const isConfigured = () => !!config.value;
  const activeWorkspace = computed(
    () => workspaces.value.find((workspace) => workspace.key === activeWorkspaceKey.value) ?? null,
  );

  return {
    workspaces,
    activeWorkspaceKey,
    activeWorkspace,
    config,
    loading,
    error,
    loadWorkspaces,
    load,
    isConfigured,
    setThinking,
    selectWorkspace,
  };
});
