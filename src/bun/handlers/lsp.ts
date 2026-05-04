import { join } from "path";
import type { Database } from "bun:sqlite";
import { getConfigDir, getConfig } from "../config/index.ts";
import { getEffectiveWorkspacePath } from "../config/path-utils.ts";
import { detectLanguages, probeInstalled } from "../lsp/detect.ts";
import { runInstall } from "../lsp/installer.ts";
import { addServerToConfig, isServerInConfig } from "../lsp/config-writer.ts";
import { LANGUAGE_REGISTRY } from "../lsp/registry.ts";
import type { LanguageEntry, InstallOption } from "../lsp/registry.ts";
import { taskLspRegistry } from "../lsp/task-registry.ts";
import type { TaskLSPRegistry } from "../lsp/task-registry.ts";
import type { IWorkspaceRepository } from "../db/workspace-repository.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import { getProjectByKey } from "../project-store.ts";

export interface DetectedLanguage {
  entry: LanguageEntry;
  alreadyInstalled: boolean;
  inConfig: boolean;
  installOptions: InstallOption[];
}

export function lspHandlers(
  db: Database,
  wsRepo: IWorkspaceRepository,
  registry: TaskLSPRegistry = taskLspRegistry,
  installer: typeof runInstall = runInstall,
  broadcast: (msg: object) => void = () => {},
) {
  return {
    "lsp.detectLanguages": async (params: { projectPath: string; workspaceKey: string }): Promise<DetectedLanguage[]> => {
      const workspaceYamlPath = join(getConfigDir(params.workspaceKey), "workspace.yaml");
      const entries = detectLanguages(params.projectPath);
      return entries.map((entry) => ({
        entry,
        alreadyInstalled: probeInstalled(entry.serverName),
        inConfig: isServerInConfig(workspaceYamlPath, entry.serverName),
        installOptions: entry.installOptions,
      }));
    },

    "lsp.addToConfig": async (params: { projectPath: string; languageServerName: string; workspaceKey: string; projectKey?: string }): Promise<{ ok: boolean }> => {
      const entry = LANGUAGE_REGISTRY.find((e) => e.serverName === params.languageServerName);
      if (!entry) return { ok: false };

      const workspaceYamlPath = join(getConfigDir(params.workspaceKey), "workspace.yaml");
      try {
        addServerToConfig(workspaceYamlPath, entry, params.projectKey);
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },

    "lsp.runInstall": async (params: { command: string; projectPath: string; workspaceKey: string; token?: string }): Promise<{ success: boolean; output: string }> => {
      const gen = installer(params.command, params.projectPath);
      const lines: string[] = [];
      let result = await gen.next();
      while (!result.done) {
        const line = result.value as string;
        lines.push(line);
        if (params.token) {
          broadcast({ type: "lsp.install.line", payload: { token: params.token, line } });
        }
        result = await gen.next();
      }
      const { success, output } = result.value as { success: boolean; output: string };

      if (success) {
        const entry = LANGUAGE_REGISTRY.find((e) =>
          e.installOptions.some((o) => o.command === params.command),
        );
        if (entry) {
          const workspaceYamlPath = join(getConfigDir(params.workspaceKey), "workspace.yaml");
          try { addServerToConfig(workspaceYamlPath, entry); } catch { /* best effort */ }
        }
      }

      return { success, output };
    },

    "lsp.workspaceSymbol": async (params: { taskId?: number; workspaceKey?: string; query: string }): Promise<unknown[]> => {
      let worktreePath: string;
      let config = getConfig(getDefaultWorkspaceKey());
      let scopeId: string | number = "default";

      if (params.taskId != null) {
        const row = db
          .query<{ board_id: number; worktree_path: string | null; project_key: string }, [number]>(
            `SELECT t.board_id, t.project_key, gc.worktree_path
             FROM tasks t
             LEFT JOIN task_git_context gc ON gc.task_id = t.id
             WHERE t.id = ?`,
          )
          .get(params.taskId);
        if (!row) return [];
        const workspaceKey = wsRepo.getBoardWorkspaceKey(row.board_id);
        config = getConfig(workspaceKey);
        if (row.worktree_path) {
          worktreePath = row.worktree_path;
        } else {
          const project = getProjectByKey(workspaceKey, row.project_key);
          const wsCfg = getWorkspaceConfig(workspaceKey);
          worktreePath = project?.projectPath.absolute ?? getEffectiveWorkspacePath(wsCfg);
        }
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

      const manager = registry.getManager(scopeId, serverConfigs, worktreePath);
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
