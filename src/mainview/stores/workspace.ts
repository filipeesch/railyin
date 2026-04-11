import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { electroview } from "../rpc";
import type { WorkspaceConfig, WorkspaceSummary } from "@shared/rpc-types";

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceSummary[]>([]);
  const activeWorkspaceId = ref<number | null>(null);
  const config = ref<WorkspaceConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function normalizeWorkspaceId(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  async function loadWorkspaces() {
    workspaces.value = await electroview.rpc.request["workspace.list"]({});
    if (!activeWorkspaceId.value && workspaces.value.length > 0) {
      activeWorkspaceId.value = workspaces.value[0].id;
    }
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      if (!activeWorkspaceId.value) {
        await loadWorkspaces();
      }
      const workspaceId = normalizeWorkspaceId(activeWorkspaceId.value);
      if (workspaceId == null) throw new Error("Invalid workspace selection");
      activeWorkspaceId.value = workspaceId;
      config.value = await electroview.rpc.request["workspace.getConfig"]({
        workspaceId,
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function setThinking(enabled: boolean) {
    await electroview.rpc.request["workspace.setThinking"]({
      workspaceId: activeWorkspaceId.value ?? undefined,
      enabled,
    });
    // Optimistically update local state so the toggle feels instant
    if (config.value) config.value = { ...config.value, enableThinking: enabled };
  }

  async function selectWorkspace(id: number | string) {
    const workspaceId = normalizeWorkspaceId(id);
    if (workspaceId == null) throw new Error("Invalid workspace selection");
    activeWorkspaceId.value = workspaceId;
    await load();
  }

  /** Derived: first workflow template from the workspace config (from boards store) */
  const isConfigured = () => !!config.value;
  const activeWorkspace = computed(
    () => workspaces.value.find((workspace) => workspace.id === activeWorkspaceId.value) ?? null,
  );

  return {
    workspaces,
    activeWorkspaceId,
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
