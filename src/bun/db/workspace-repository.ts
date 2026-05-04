import type { Database } from "bun:sqlite";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

export interface IWorkspaceRepository {
  getBoardWorkspaceKey(boardId: number): string;
  getTaskWorkspaceKey(taskId: number): string;
}

export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private readonly db: Database) {}

  getBoardWorkspaceKey(boardId: number): string {
    return (
      this.db
        .query<{ workspace_key: string }, [number]>(
          "SELECT workspace_key FROM boards WHERE id = ?",
        )
        .get(boardId)?.workspace_key ?? getDefaultWorkspaceKey()
    );
  }

  getTaskWorkspaceKey(taskId: number): string {
    return (
      this.db
        .query<{ workspace_key: string }, [number]>(
          `SELECT b.workspace_key
           FROM tasks t
           JOIN boards b ON b.id = t.board_id
           WHERE t.id = ?`,
        )
        .get(taskId)?.workspace_key ?? getDefaultWorkspaceKey()
    );
  }
}
