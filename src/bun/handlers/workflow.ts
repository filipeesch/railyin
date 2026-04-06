import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { getConfigDir, resetConfig, loadConfig } from "../config/index.ts";

export function workflowHandlers(notifyReloaded: () => void) {
  return {
    "workflow.getYaml": async (params: { templateId: string }): Promise<{ yaml: string }> => {
      const filePath = join(getConfigDir(), "workflows", `${params.templateId}.yaml`);
      if (!existsSync(filePath)) {
        throw new Error(`Workflow template not found: ${params.templateId}`);
      }
      const content = readFileSync(filePath, "utf-8");
      return { yaml: content };
    },

    "workflow.saveYaml": async (params: { templateId: string; yaml: string }): Promise<{ ok: true }> => {
      // Validate YAML before writing
      try {
        yaml.load(params.yaml);
      } catch (err) {
        throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
      }

      const filePath = join(getConfigDir(), "workflows", `${params.templateId}.yaml`);
      if (!existsSync(filePath)) {
        throw new Error(`Workflow template not found: ${params.templateId}`);
      }

      writeFileSync(filePath, params.yaml, "utf-8");

      // Reload in-memory config
      resetConfig();
      loadConfig();

      // Notify frontend
      notifyReloaded();

      return { ok: true };
    },
  };
}
