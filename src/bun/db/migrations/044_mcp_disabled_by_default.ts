import type { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "044_mcp_disabled_by_default";

export function up(db: Database): void {
  if (hasTable(db, "tasks") && !hasColumn(db, "tasks", "enabled_mcp_tools")) {
    db.exec("ALTER TABLE tasks ADD COLUMN enabled_mcp_tools TEXT NULL;");
  }
  if (hasTable(db, "chat_sessions") && !hasColumn(db, "chat_sessions", "enabled_mcp_tools")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN enabled_mcp_tools TEXT NULL;");
  }
  if (hasTable(db, "tasks")) {
    db.run(`UPDATE tasks SET enabled_mcp_tools = '[]' WHERE enabled_mcp_tools IS NULL`);
  }
  if (hasTable(db, "chat_sessions")) {
    db.run(`UPDATE chat_sessions SET enabled_mcp_tools = '[]' WHERE enabled_mcp_tools IS NULL`);
  }
}
