import { join } from "path";
import type { Database } from "bun:sqlite";
import { getConfigDir, getConfig } from "../config/index.ts";
import { getEffectiveWorkspacePath } from "../config/path-utils.ts";
import { detectLanguages, probeInstalled } from "../lsp/detect.ts";
import { runInstall } from "../lsp/installer.ts";
import { addServerToConfig } from "../lsp/config-writer.ts";
import { LANGUAGE_REGISTRY } from "../lsp/registry.ts";
import type { LanguageEntry, InstallOption } from "../lsp/registry.ts";
import { taskLspRegistry } from "../lsp/task-registry.ts";
import { getBoardWorkspaceKey, getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";

export interface DetectedLanguage {
  entry: LanguageEntry;
  alreadyInstalled: boolean;
  installOptions: InstallOption[];
}

export function lspHandlers(db: Database) {
  return {
    "lsp.detectLanguages": async (params: { projectPath: string }): Promise<DetectedLanguage[]> => {
      const entries = detectLanguages(params.projectPath);
      return entries.map((entry) => ({
        entry,
        alreadyInstalled: probeInstalled(entry.serverName),
        installOptions: entry.installOptions, // already platform-filtered by detectLanguages
      }));
    },

    "lsp.addToConfig": async (params: { projectPath: string; languageServerName: string }): Promise<{ ok: boolean }> => {
      const entry = LANGUAGE_REGISTRY.find((e) => e.serverName === params.languageServerName);
      if (!entry) return { ok: false };

      const workspaceYamlPath = join(getConfigDir(), "workspace.yaml");
      try {
        addServerToConfig(workspaceYamlPath, entry);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },

    "lsp.runInstall": async (params: { command: string; projectPath: string }): Promise<{ success: boolean; output: string }> => {
      // Collect full output (streaming is done via the installer generator)
      const gen = runInstall(params.command, params.projectPath);
      const lines: string[] = [];
      let result = await gen.next();
      while (!result.done) {
        lines.push(result.value as string);
        result = await gen.next();
      }
      const { success, output } = result.value as { success: boolean; output: string };

      // Auto-write config on successful install
      if (success) {
        const entry = LANGUAGE_REGISTRY.find((e) =>
          e.installOptions.some((o) => o.command === params.command),
        );
        if (entry) {
          const workspaceYamlPath = join(getConfigDir(), "workspace.yaml");
          try { addServerToConfig(workspaceYamlPath, entry); } catch { /* best effort */ }
        }
      }

      return { success, output };
    },

    "lsp.workspaceSymbol": async (params: { taskId?: number; workspaceKey?: string; query: string }): Promise<unknown[]> => {
      let worktreePath = process.cwd();
      let config = getConfig(getDefaultWorkspaceKey());
      let scopeId: string | number = "default";

      if (params.taskId != null) {
        const row = db
          .query<{ board_id: number; worktree_path: string | null }, [number]>(
            `SELECT t.board_id, gc.worktree_path
             FROM tasks t
             LEFT JOIN task_git_context gc ON gc.task_id = t.id
             WHERE t.id = ?`,
          )
          .get(params.taskId);
        if (!row) return [];
        worktreePath = row.worktree_path ?? process.cwd();
        config = getConfig(getBoardWorkspaceKey(row.board_id));
        scopeId = params.taskId;
      } else {
        const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
        const workspaceConfig = getWorkspaceConfig(workspaceKey);
        worktreePath = getEffectiveWorkspacePath(workspaceConfig);
        config = workspaceConfig;
        scopeId = `workspace:${workspaceKey}`;
      }

      const serverConfigs = config.workspace.lsp?.servers ?? [];
      if (serverConfigs.length === 0) return [];

      const manager = taskLspRegistry.getManager(scopeId, serverConfigs, worktreePath);
      if (!manager) return [];

      try {
        const result = await manager.requestWorkspaceSymbol<unknown[]>(worktreePath, params.query);
        return Array.isArray(result) ? result : [];
      } catch {
        return [];
      }
    },
  };
}
