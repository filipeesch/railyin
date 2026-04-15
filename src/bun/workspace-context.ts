import { getDb } from "./db/index.ts";
import { getConfig, getWorkspaceRegistry, loadConfig, runWithConfig, type LoadedConfig } from "./config/index.ts";

export function getDefaultWorkspaceKey(): string {
  return getWorkspaceRegistry()[0]?.key ?? "default";
}

export function getWorkspaceConfig(workspaceKey: string): LoadedConfig {
  const loaded = loadConfig(workspaceKey).config;
  return loaded ?? getConfig(workspaceKey);
}

export function runWithWorkspaceKey<T>(workspaceKey: string, fn: () => T): T {
  return runWithConfig(getWorkspaceConfig(workspaceKey), fn);
}

export function getBoardWorkspaceKey(boardId: number): string {
  const db = getDb();
  return db
    .query<{ workspace_key: string }, [number]>("SELECT workspace_key FROM boards WHERE id = ?")
    .get(boardId)?.workspace_key ?? getDefaultWorkspaceKey();
}

export function getTaskWorkspaceKey(taskId: number): string {
  const db = getDb();
  return db
    .query<{ workspace_key: string }, [number]>(
      `SELECT b.workspace_key
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       WHERE t.id = ?`,
    )
    .get(taskId)?.workspace_key ?? getDefaultWorkspaceKey();
}
