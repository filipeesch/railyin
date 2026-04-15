import { getConfig, getWorkspaceRegistry, resetConfig, loadConfig, patchWorkspaceYaml } from "../config/index.ts";
import { clearProviderCache } from "../ai/index.ts";
import type { WorkspaceConfig, WorkspaceSummary } from "../../shared/rpc-types.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";

export function workspaceHandlers() {
  return {
    "workspace.getConfig": async (params: { workspaceKey?: string }): Promise<WorkspaceConfig> => {
      resetConfig();
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const { error } = loadConfig(workspaceKey);
      if (error) throw new Error(error);
      const config = getConfig(workspaceKey);

      // Support both legacy `ai:` block and new `providers:` list
      const legacyAi = config.workspace.ai;
      const firstProvider = config.providers[0];

      return {
        key: config.workspaceKey,
        name: config.workspaceName,
        workflows: config.workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          columns: workflow.columns.map((column) => ({
            id: column.id,
            label: column.label,
            model: column.model,
          })),
        })),
        ai: {
          baseUrl: legacyAi?.base_url ?? firstProvider?.base_url ?? "",
          apiKey: legacyAi?.api_key ?? firstProvider?.api_key ?? "",
          model: legacyAi?.model ?? "",
          provider: legacyAi?.provider ?? firstProvider?.type ?? "openai-compatible",
          contextWindowTokens: legacyAi?.context_window_tokens ?? firstProvider?.context_window_tokens,
        },
        worktreeBasePath: config.workspace.worktree_base_path ?? "",
        enableThinking: config.workspace.anthropic?.enable_thinking ?? false,
      };
    },

    "workspace.list": async (): Promise<WorkspaceSummary[]> => {
      resetConfig();
      return getWorkspaceRegistry().map((workspace) => ({
        key: workspace.key,
        name: workspace.name,
      }));
    },

    "workspace.setThinking": async (params: { workspaceKey?: string; enabled: boolean }): Promise<Record<string, never>> => {
      resetConfig();
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      patchWorkspaceYaml({ anthropic: { enable_thinking: params.enabled } }, workspaceKey);
      // Clear provider cache so the next execution picks up the new setting
      clearProviderCache();
      return {};
    },
  };
}
