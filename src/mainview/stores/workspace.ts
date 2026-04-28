import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "../rpc";
import type { ModelInfo, ProviderModelList, WorkspaceConfig, WorkspaceSummary } from "@shared/rpc-types";

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceSummary[]>([]);
  const activeWorkspaceKey = ref<string | null>(null);
  const config = ref<WorkspaceConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const availableModels = ref<ModelInfo[]>([]);
  const allProviderModels = ref<ProviderModelList[]>([]);

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

  async function create(name: string) {
    const newWorkspace = await api("workspace.create", { name });
    workspaces.value.push(newWorkspace);
    await selectWorkspace(newWorkspace.key);
    return newWorkspace;
  }

  async function update(params: { name?: string; engineType?: string; engineModel?: string; worktreeBasePath?: string; workspacePath?: string }) {
    await api("workspace.update", {
      workspaceKey: activeWorkspaceKey.value ?? undefined,
      ...params,
    });
    await load();
    if (params.name !== undefined) {
      await loadWorkspaces();
    }
  }

  async function resolveGitRoot(path: string): Promise<string | null> {
    const result = await api("workspace.resolveGitRoot", { path });
    return result.gitRoot;
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

  async function loadEnabledModels(workspaceKey?: string) {
    availableModels.value = await api("models.listEnabled", { workspaceKey });
  }

  async function loadAllModels(workspaceKey?: string) {
    allProviderModels.value = await api("models.list", { workspaceKey });
  }

  async function setModelEnabled(qualifiedModelId: string, enabled: boolean, workspaceKey?: string) {
    await api("models.setEnabled", { workspaceKey, qualifiedModelId, enabled });
    for (const provider of allProviderModels.value) {
      const model = provider.models.find((entry) => entry.id === qualifiedModelId);
      if (model) {
        model.enabled = enabled;
        break;
      }
    }
    availableModels.value = await api("models.listEnabled", { workspaceKey });
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
    availableModels,
    allProviderModels,
    loading,
    error,
    loadWorkspaces,
    load,
    loadEnabledModels,
    loadAllModels,
    setModelEnabled,
    isConfigured,
    setThinking,
    selectWorkspace,
    create,
    update,
    resolveGitRoot,
  };
});
