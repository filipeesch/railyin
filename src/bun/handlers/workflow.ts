import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { getConfigDir, resetConfig, loadConfig } from "../config/index.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

function resolveWorkflowFilePath(workspaceKey: string, templateId: string): string | null {
  const workflowsDir = join(getConfigDir(workspaceKey), "workflows");
  const directPath = join(workflowsDir, `${templateId}.yaml`);
  if (existsSync(directPath)) return directPath;

  if (!existsSync(workflowsDir)) return null;
  for (const fileName of readdirSync(workflowsDir)) {
    if (!fileName.endsWith(".yaml") && !fileName.endsWith(".yml")) continue;
    const filePath = join(workflowsDir, fileName);
    try {
      const parsed = yaml.load(readFileSync(filePath, "utf-8")) as { id?: string } | null;
      if (parsed?.id === templateId) return filePath;
    } catch {
      // Ignore invalid files when searching; existing validation happens elsewhere.
    }
  }
  return null;
}

export function workflowHandlers(notifyReloaded: () => void) {
  return {
    "workflow.getYaml": async (params: { workspaceKey?: string; templateId: string }): Promise<{ yaml: string }> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const filePath = resolveWorkflowFilePath(workspaceKey, params.templateId);
      if (!filePath) {
        throw new Error(`Workflow template not found: ${params.templateId}`);
      }
      const content = readFileSync(filePath, "utf-8");
      return { yaml: content };
    },

    "workflow.saveYaml": async (params: { workspaceKey?: string; templateId: string; yaml: string }): Promise<{ ok: true }> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      // Validate YAML before writing
      try {
        yaml.load(params.yaml);
      } catch (err) {
        throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
      }

      const filePath = resolveWorkflowFilePath(workspaceKey, params.templateId);
      if (!filePath) {
        throw new Error(`Workflow template not found: ${params.templateId}`);
      }

      writeFileSync(filePath, params.yaml, "utf-8");

      // Reload in-memory config
      resetConfig();
      loadConfig(workspaceKey);

      // Notify frontend
      notifyReloaded();

      return { ok: true };
    },
  };
}
