import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "024_todo_v2";

export function up(db: Database): void {
  if (hasTable(db, "task_todos")) {
    if (!hasColumn(db, "task_todos", "number")) {
      db.exec("ALTER TABLE task_todos ADD COLUMN number REAL NOT NULL DEFAULT 0");
      db.exec("UPDATE task_todos SET number = id");
    }
    if (!hasColumn(db, "task_todos", "description")) {
      db.exec("ALTER TABLE task_todos ADD COLUMN description TEXT NOT NULL DEFAULT ''");
    }
    db.exec("UPDATE task_todos SET status = 'pending' WHERE status = 'not-started'");
    db.exec("UPDATE task_todos SET status = 'done' WHERE status = 'completed'");
  }
}
