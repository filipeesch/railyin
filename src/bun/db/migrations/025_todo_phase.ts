import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "025_todo_phase";

export function up(db: Database): void {
  if (hasTable(db, "task_todos") && !hasColumn(db, "task_todos", "phase")) {
    db.exec("ALTER TABLE task_todos ADD COLUMN phase TEXT NULL;");
  }
}
