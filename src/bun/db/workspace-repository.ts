import type { Db } from "./db.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

export interface IWorkspaceRepository {
  getBoardWorkspaceKey(boardId: number): Promise<string>;
  getTaskWorkspaceKey(taskId: number): Promise<string>;
}

export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private readonly db: Db) {}

  async getBoardWorkspaceKey(boardId: number): Promise<string> {
    const row = await this.db.get<{ workspace_key: string }>(
      "SELECT workspace_key FROM boards WHERE id = $1",
      [boardId],
    );
    return row?.workspace_key ?? getDefaultWorkspaceKey();
  }

  async getTaskWorkspaceKey(taskId: number): Promise<string> {
    const row = await this.db.get<{ workspace_key: string }>(
      `SELECT b.workspace_key
       FROM tasks t
       JOIN boards b ON b.id = t.board_id
       WHERE t.id = $1`,
      [taskId],
    );
    return row?.workspace_key ?? getDefaultWorkspaceKey();
  }
}
