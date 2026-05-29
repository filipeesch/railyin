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

  async function update(params: { name?: string; allowedEngines?: string[]; defaultModel?: string; worktreeBasePath?: string; workspacePath?: string; shellAutoApprove?: boolean }) {
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

  async function setModelContextWindow(qualifiedModelId: string, contextWindow: number | null, workspaceKey?: string) {
    await api("models.setContextWindow", { workspaceKey, qualifiedModelId, contextWindow });
    for (const provider of allProviderModels.value) {
      const model = provider.models.find((entry) => entry.id === qualifiedModelId);
      if (model) {
        model.contextWindow = contextWindow;
        break;
      }
    }
  }

  /** Derived: first workflow template from the workspace config (from boards store) */
  const isConfigured = () => !!config.value;
  const activeWorkspace = computed(
    () => workspaces.value.find((workspace) => workspace.key === activeWorkspaceKey.value) ?? null,
  );

  /** Models grouped by engineId. Keys are engine IDs (e.g. "copilot", "claude"). */
  const modelsByEngine = computed(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const model of availableModels.value) {
      const key = model.engineId ?? (model.id != null ? model.id.split("/")[0] : "copilot");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(model);
    }
    return map;
  });

  return {
    workspaces,
    activeWorkspaceKey,
    activeWorkspace,
    config,
    availableModels,
    allProviderModels,
    modelsByEngine,
    loading,
    error,
    loadWorkspaces,
    load,
    loadEnabledModels,
    loadAllModels,
    setModelEnabled,
    setModelContextWindow,
    isConfigured,
    selectWorkspace,
    create,
    update,
    resolveGitRoot,
  };
});
