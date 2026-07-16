/**
 * Builds the base options for `Agent.create` / `Agent.resume`.
 *
 * `settingSources: ["project"]` ensures `.cursorrules` and
 * `.cursor/rules/*.mdc` are loaded automatically from the working directory.
 */

import type { AgentOptions, LocalAgentOptions, ModelParameterValue, SDKCustomTool } from "@cursor/sdk";

/** `buildBaseOptions` always sets `local`, so callers can rely on it being present. */
export interface CursorBaseOptions extends AgentOptions {
  local: LocalAgentOptions;
}

export function buildBaseOptions(
  apiKey: string | undefined,
  model: string | undefined,
  workingDirectory: string,
  customTools: Record<string, SDKCustomTool>,
  modelParams?: ModelParameterValue[],
): CursorBaseOptions {
  return {
    model: model ? { id: model, ...(modelParams && modelParams.length > 0 ? { params: modelParams } : {}) } : undefined,
    apiKey,
    local: {
      cwd: workingDirectory,
      customTools,
      settingSources: ["project"],
    },
  };
}
