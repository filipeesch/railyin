import { defineStore } from "pinia";
import { ref } from "vue";
import { electroview } from "../rpc";
import type { WorkspaceConfig, WorkflowTemplate } from "@shared/rpc-types";

export const useWorkspaceStore = defineStore("workspace", () => {
  const config = ref<WorkspaceConfig | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      config.value = await electroview.rpc.request["workspace.getConfig"]({});
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  /** Derived: first workflow template from the workspace config (from boards store) */
  const isConfigured = () => !!config.value;

  return { config, loading, error, load, isConfigured };
});
