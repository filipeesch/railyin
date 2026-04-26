import { Database } from "bun:sqlite";
import { hasColumn } from "./_utils.ts";

export const id = "007_shell_command_approval";

export function up(db: Database): void {
  if (!hasColumn(db, "tasks", "shell_auto_approve")) {
    db.exec("ALTER TABLE tasks ADD COLUMN shell_auto_approve INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "tasks", "approved_commands")) {
    db.exec("ALTER TABLE tasks ADD COLUMN approved_commands TEXT NOT NULL DEFAULT '[]'");
  }
}
