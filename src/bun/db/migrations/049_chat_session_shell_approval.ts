import type { Database } from "bun:sqlite";

export const id = "049_chat_session_shell_approval";

export function up(db: Database): void {
  db.exec("ALTER TABLE chat_sessions ADD COLUMN shell_auto_approve INTEGER NOT NULL DEFAULT 0");
  db.exec("ALTER TABLE chat_sessions ADD COLUMN approved_commands TEXT NOT NULL DEFAULT '[]'");
}
