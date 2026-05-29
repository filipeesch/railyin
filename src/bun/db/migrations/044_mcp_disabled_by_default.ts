import type { Database } from "bun:sqlite";

export const id = "044_mcp_disabled_by_default";

export function up(db: Database): void {
  db.run(`UPDATE tasks SET enabled_mcp_tools = '[]' WHERE enabled_mcp_tools IS NULL`);
  db.run(`UPDATE chat_sessions SET enabled_mcp_tools = '[]' WHERE enabled_mcp_tools IS NULL`);
}
