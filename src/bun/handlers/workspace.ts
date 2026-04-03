import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import type { WorkspaceConfig } from "../../shared/rpc-types.ts";

export function workspaceHandlers() {
  return {
    "workspace.getConfig": async (): Promise<WorkspaceConfig> => {
      const db = getDb();
      const config = getConfig();

      const workspace = db
        .query<{ id: number; name: string }, []>(
          "SELECT id, name FROM workspaces LIMIT 1",
        )
        .get();

      return {
        id: workspace?.id ?? 1,
        name: workspace?.name ?? "My Workspace",
        ai: {
          baseUrl: config.workspace.ai.base_url,
          apiKey: config.workspace.ai.api_key ?? "",
          model: config.workspace.ai.model,
          provider: config.workspace.ai.provider ?? "openai-compatible",
          contextWindowTokens: config.workspace.ai.context_window_tokens,
        },
        worktreeBasePath: config.workspace.worktree_base_path ?? "",
      };
    },
  };
}
