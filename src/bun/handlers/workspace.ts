import { getDb } from "../db/index.ts";
import { getConfig, resetConfig, loadConfig, patchWorkspaceYaml } from "../config/index.ts";
import { clearProviderCache } from "../ai/index.ts";
import type { WorkspaceConfig } from "../../shared/rpc-types.ts";

export function workspaceHandlers() {
  return {
    "workspace.getConfig": async (): Promise<WorkspaceConfig> => {
      // Always reload from disk so the Reload config button picks up changes
      resetConfig();
      const { error } = loadConfig();
      if (error) throw new Error(error);
      const db = getDb();
      const config = getConfig();

      const workspace = db
        .query<{ id: number; name: string }, []>(
          "SELECT id, name FROM workspaces LIMIT 1",
        )
        .get();

      // Support both legacy `ai:` block and new `providers:` list
      const legacyAi = config.workspace.ai;
      const firstProvider = config.providers[0];

      return {
        id: workspace?.id ?? 1,
        name: workspace?.name ?? "My Workspace",
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

    "workspace.setThinking": async (params: { enabled: boolean }): Promise<Record<string, never>> => {
      patchWorkspaceYaml({ anthropic: { enable_thinking: params.enabled } });
      // Clear provider cache so the next execution picks up the new setting
      clearProviderCache();
      return {};
    },
  };
}
