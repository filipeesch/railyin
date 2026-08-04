/**
 * Board queries — extracted from src/bun/handlers/boards.ts for testability.
 *
 * Provides a reusable function to list boards by workspace key without
 * loading workflow templates. The boards.list RPC handler uses this function
 * and then enriches the result with template data.
 */

import type { Db } from "./db.ts";
import type { BoardRow } from "./row-types.ts";

/**
 * List boards, optionally filtered by workspace key.
 * Returns minimal data (id, name, workspace_key) ordered by creation time.
 */
export async function listBoardsByWorkspace(
  db: Db,
  workspaceKey?: string,
): Promise<Pick<BoardRow, "id" | "name" | "workspace_key">[]> {
  if (workspaceKey) {
    return db.rows<Pick<BoardRow, "id" | "name" | "workspace_key">>(
      "SELECT id, name, workspace_key FROM boards WHERE workspace_key = $1 ORDER BY created_at ASC",
      [workspaceKey],
    );
  }
  return db.rows<Pick<BoardRow, "id" | "name" | "workspace_key">>(
    "SELECT id, name, workspace_key FROM boards ORDER BY created_at ASC",
  );
}
