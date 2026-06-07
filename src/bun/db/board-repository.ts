import type { Database } from "bun:sqlite";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BoardSummary {
  id: number;
  name: string;
}

export interface BoardDetail extends BoardSummary {
  workspaceKey: string;
}

// ─── Row types ────────────────────────────────────────────────────────────────

interface BoardRow {
  id: number;
  name: string;
  workspace_key: string;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IBoardRepository {
  listByWorkspace(workspaceKey: string): BoardSummary[];
  getById(id: number): BoardDetail | null;
  exists(id: number): boolean;
  getWorkspaceKey(boardId: number): string | null;
}

// ─── BoardRepository ──────────────────────────────────────────────────────────

export class BoardRepository implements IBoardRepository {
  constructor(private readonly db: Database) {}

  listByWorkspace(workspaceKey: string): BoardSummary[] {
    return this.db
      .query<{ id: number; name: string }, [string]>(
        "SELECT id, name FROM boards WHERE workspace_key = ? ORDER BY created_at ASC",
      )
      .all(workspaceKey);
  }

  getById(id: number): BoardDetail | null {
    const row = this.db
      .query<BoardRow, [number]>(
        "SELECT id, name, workspace_key FROM boards WHERE id = ?",
      )
      .get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      workspaceKey: row.workspace_key,
    };
  }

  exists(id: number): boolean {
    const row = this.db
      .query<{ id: number }, [number]>("SELECT id FROM boards WHERE id = ?")
      .get(id);
    return row !== undefined;
  }

  getWorkspaceKey(boardId: number): string | null {
    return (
      this.db
        .query<{ workspace_key: string }, [number]>(
          "SELECT workspace_key FROM boards WHERE id = ?",
        )
        .get(boardId)?.workspace_key ?? null
    );
  }
}
