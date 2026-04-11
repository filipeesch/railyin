import { getDb } from "./db/index.ts";
import { getConfig, getWorkspaceRegistry, loadConfig, runWithConfig, type LoadedConfig } from "./config/index.ts";

export function getDefaultWorkspaceId(): number {
  return getWorkspaceRegistry()[0]?.id ?? 1;
}

export function getWorkspaceKeyById(workspaceId: number): string {
  return getWorkspaceRegistry().find((entry) => entry.id === workspaceId)?.key
    ?? getWorkspaceRegistry()[0]?.key
    ?? "default";
}

export function getWorkspaceConfigById(workspaceId: number): LoadedConfig {
  const key = getWorkspaceKeyById(workspaceId);
  const loaded = loadConfig(key).config;
  return loaded ?? getConfig(key);
}

export function runWithWorkspaceId<T>(workspaceId: number, fn: () => T): T {
  return runWithConfig(getWorkspaceConfigById(workspaceId), fn);
}

export function getBoardWorkspaceId(boardId: number): number {
  const db = getDb();
  return db
    .query<{ workspace_id: number }, [number]>("SELECT workspace_id FROM boards WHERE id = ?")
    .get(boardId)?.workspace_id ?? getDefaultWorkspaceId();
}

export function getTaskWorkspaceId(taskId: number): number {
  const db = getDb();
  return db
    .query<{ workspace_id: number }, [number]>(
      `SELECT b.workspace_id
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       WHERE t.id = ?`,
    )
    .get(taskId)?.workspace_id ?? getDefaultWorkspaceId();
}
