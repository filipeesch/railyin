import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "028_chat_session_mcp_tools";

export function up(db: Database): void {
  if (hasTable(db, "chat_sessions") && !hasColumn(db, "chat_sessions", "enabled_mcp_tools")) {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN enabled_mcp_tools TEXT NULL;");
  }
}
