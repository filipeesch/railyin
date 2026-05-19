import { readFileSync, writeFileSync } from "fs";
import type { Database } from "bun:sqlite";
import * as yaml from "js-yaml";
import { getConfigDir, resetConfig, loadConfig } from "../config/index.ts";
import {
  resolveWorkflowFilePath,
  listWorkflowFiles,
  listBundledWorkflowIds,
  createWorkflowFile,
  deleteWorkflowFile,
  evaluateDeletable,
} from "../config/workflows.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";
import type { WorkflowSummary } from "../../shared/rpc-types.ts";

/** Count, per workflow template id, how many boards in the workspace reference it. */
function boardCountsByWorkflow(db: Database, workspaceKey: string): Record<string, number> {
  const rows = db
    .query<{ workflow_template_id: string; count: number }, [string]>(
      "SELECT workflow_template_id, COUNT(*) as count FROM boards WHERE workspace_key = ? GROUP BY workflow_template_id",
    )
    .all(workspaceKey);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.workflow_template_id] = row.count;
  return counts;
}

export function workflowHandlers(db: Database, notifyReloaded: () => void) {
  return {
    "workflow.list": async (params: { workspaceKey?: string }): Promise<WorkflowSummary[]> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const files = listWorkflowFiles(getConfigDir(workspaceKey));
      const counts = boardCountsByWorkflow(db, workspaceKey);
      const bundled = listBundledWorkflowIds();
      return files.map((wf) => {
        const guard = evaluateDeletable(wf.id, counts, files.length, bundled.has(wf.id));
        return {
          id: wf.id,
          name: wf.name,
          boardCount: counts[wf.id] ?? 0,
          deletable: guard.deletable,
          undeletableReason: guard.undeletableReason,
        };
      });
    },

    "workflow.create": async (params: { workspaceKey?: string; name: string }): Promise<{ id: string }> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const name = params.name?.trim();
      if (!name) throw new Error("Workflow name is required");

      const id = createWorkflowFile(getConfigDir(workspaceKey), name);

      resetConfig();
      loadConfig(workspaceKey);
      notifyReloaded();

      return { id };
    },

    "workflow.delete": async (params: { workspaceKey?: string; templateId: string }): Promise<{ ok: true }> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const configDir = getConfigDir(workspaceKey);

      // Re-validate the delete guard server-side.
      const files = listWorkflowFiles(configDir);
      const counts = boardCountsByWorkflow(db, workspaceKey);
      const guard = evaluateDeletable(
        params.templateId,
        counts,
        files.length,
        listBundledWorkflowIds().has(params.templateId),
      );
      if (!guard.deletable) {
        throw new Error(guard.undeletableReason ?? "This workflow cannot be deleted");
      }

      deleteWorkflowFile(configDir, params.templateId);

      resetConfig();
      loadConfig(workspaceKey);
      notifyReloaded();

      return { ok: true };
    },

    "workflow.getYaml": async (params: { workspaceKey?: string; templateId: string }): Promise<{ yaml: string }> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const filePath = resolveWorkflowFilePath(getConfigDir(workspaceKey), params.templateId);
      if (!filePath) {
        throw new Error(`Workflow template not found: ${params.templateId}`);
      }
      return { yaml: readFileSync(filePath, "utf-8") };
    },

    "workflow.saveYaml": async (params: { workspaceKey?: string; templateId: string; yaml: string }): Promise<{ ok: true }> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();

      // Validate YAML before writing.
      try {
        yaml.load(params.yaml);
      } catch (err) {
        throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
      }

      const filePath = resolveWorkflowFilePath(getConfigDir(workspaceKey), params.templateId);
      if (!filePath) {
        throw new Error(`Workflow template not found: ${params.templateId}`);
      }

      writeFileSync(filePath, params.yaml, "utf-8");

      // Reload in-memory config and notify the frontend.
      resetConfig();
      loadConfig(workspaceKey);
      notifyReloaded();

      return { ok: true };
    },
  };
}
