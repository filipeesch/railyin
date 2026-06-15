/**
 * Board queries — extracted from src/bun/handlers/boards.ts for testability.
 *
 * Provides a reusable function to list boards by workspace key without
 * loading workflow templates. The boards.list RPC handler uses this function
 * and then enriches the result with template data.
 */

import type { Database } from "bun:sqlite";
import type { BoardRow } from "./row-types.ts";

/**
 * List boards, optionally filtered by workspace key.
 * Returns minimal data (id, name, workspace_key) ordered by creation time.
 */
export function listBoardsByWorkspace(
  db: Database,
  workspaceKey?: string,
): Pick<BoardRow, "id" | "name" | "workspace_key">[] {
  if (workspaceKey) {
    return db
      .query<Pick<BoardRow, "id" | "name" | "workspace_key">, [string]>(
        "SELECT id, name, workspace_key FROM boards WHERE workspace_key = ? ORDER BY created_at ASC",
        [workspaceKey],
      )
      .all();
  }
  return db
    .query<Pick<BoardRow, "id" | "name" | "workspace_key">, []>(
      "SELECT id, name, workspace_key FROM boards ORDER BY created_at ASC",
      [],
    )
    .all();
}
