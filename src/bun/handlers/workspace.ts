import { existsSync } from "fs";
import { join } from "path";
import { getConfig, getWorkspaceRegistry, resetConfig, loadConfig, patchWorkspaceYaml, sanitizeWorkspaceKey, ensureConfigExists, type WorkspaceYaml } from "../config/index.ts";
import { clearProviderCache } from "../ai/index.ts";
import type { WorkspaceConfig, WorkspaceSummary } from "../../shared/rpc-types.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import { getDb } from "../db/index.ts";

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
        engine: {
          type: config.engine.type,
          model: config.engine.model,
        },
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

    "workspace.create": async (params: { name: string }): Promise<WorkspaceSummary> => {
      const workspacesRoot = process.env.RAILYN_WORKSPACES_DIR ?? join(process.env.HOME ?? "~", ".railyn", "workspaces");
      const key = sanitizeWorkspaceKey(params.name, "workspace");
      const configDir = join(workspacesRoot, key);
      if (existsSync(configDir)) throw new Error(`Workspace already exists: ${key}`);
      ensureConfigExists(configDir);
      resetConfig();
      return { key, name: params.name.trim() };
    },

    "workspace.update": async (params: { workspaceKey?: string; name?: string; engineType?: string; engineModel?: string; worktreeBasePath?: string }): Promise<Record<string, never>> => {
      resetConfig();
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const patch: Partial<WorkspaceYaml> = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.worktreeBasePath !== undefined) patch.worktree_base_path = params.worktreeBasePath;
      if (params.engineType !== undefined || params.engineModel !== undefined) {
        const existing = getConfig(workspaceKey).engine;
        patch.engine = {
          type: (params.engineType ?? existing.type) as "copilot" | "claude",
          ...(params.engineModel ? { model: params.engineModel } : {}),
        };
      }
      patchWorkspaceYaml(patch, workspaceKey);
      clearProviderCache();
      return {};
    },

    "workspace.resolveGitRoot": async (params: { path: string }): Promise<{ gitRoot: string | null }> => {
      try {
        const proc = Bun.spawn(["git", "-C", params.path, "rev-parse", "--show-toplevel"], {
          stdout: "pipe",
          stderr: "ignore",
        });
        const text = (await new Response(proc.stdout).text()).trim();
        const code = await proc.exited;
        return { gitRoot: code === 0 && text ? text : null };
      } catch {
        return { gitRoot: null };
      }
    },

    "workspace.openFolderDialog": async (params: { initialPath?: string }): Promise<{ path: string | null }> => {
      const platform = process.platform;
      const expandHome = (p: string) => p.startsWith("~/") || p === "~"
        ? p.replace("~", process.env.HOME ?? "/tmp")
        : p;
      try {
        if (platform === "darwin") {
          const initial = expandHome(params.initialPath?.trim() || process.env.HOME || "/tmp");
          const script = `POSIX path of (choose folder with prompt "Select folder:" default location POSIX file "${initial}" without multiple selections allowed)`;
          const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "ignore" });
          const text = (await new Response(proc.stdout).text()).trim();
          const code = await proc.exited;
          return { path: code === 0 && text ? text.replace(/\/$/, "") : null };
        } else if (platform === "linux") {
          const args = ["--file-selection", "--directory", "--title=Select folder"];
          if (params.initialPath) args.push(`--filename=${expandHome(params.initialPath)}/`);
          const proc = Bun.spawn(["zenity", ...args], { stdout: "pipe", stderr: "ignore" });
          const text = (await new Response(proc.stdout).text()).trim();
          const code = await proc.exited;
          return { path: code === 0 && text ? text.replace(/\/$/, "") : null };
        } else if (platform === "win32") {
          const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`;
          const proc = Bun.spawn(["powershell", "-NoProfile", "-Command", ps], { stdout: "pipe", stderr: "ignore" });
          const text = (await new Response(proc.stdout).text()).trim();
          const code = await proc.exited;
          return { path: code === 0 && text ? text : null };
        }
        return { path: null };
      } catch {
        return { path: null };
      }
    },

    "workspace.listFiles": async (params: { taskId?: number; workspaceKey?: string; query?: string }): Promise<{ name: string; path: string }[]> => {
      const db = getDb();
      let cwd = process.cwd();
      if (params.taskId != null) {
        const row = db
          .query<{ worktree_path: string | null }, [number]>(
            "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
          )
          .get(params.taskId);
        cwd = row?.worktree_path ?? cwd;
      } else {
        const workspaceConfig = getWorkspaceConfig(params.workspaceKey ?? getDefaultWorkspaceKey());
        cwd = workspaceConfig.workspace.workspace_path ?? workspaceConfig.configDir;
      }

      const proc = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
        cwd,
        stderr: "ignore",
      });
      const text = await new Response(proc.stdout).text();
      await proc.exited;

      const query = params.query?.toLowerCase() ?? "";
      const files = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => !query || line.toLowerCase().includes(query))
        .map((filePath) => {
          const parts = filePath.split("/");
          return { name: parts[parts.length - 1], path: filePath };
        });

      return files;
    },
  };
}
