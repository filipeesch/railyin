import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../rpc";
import type { WorkflowSummary } from "@shared/rpc-types";

/** Workflow templates for the active workspace, with delete-guard metadata. */
export const useWorkflowStore = defineStore("workflow", () => {
  const workflows = ref<WorkflowSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadWorkflows(workspaceKey?: string) {
    loading.value = true;
    error.value = null;
    try {
      workflows.value = await api("workflow.list", { workspaceKey });
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  return { workflows, loading, error, loadWorkflows };
});
