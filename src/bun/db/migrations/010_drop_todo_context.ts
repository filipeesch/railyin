import { Database } from "bun:sqlite";

export const id = "010_drop_todo_context";

export function up(db: Database): void {
  db.exec("ALTER TABLE task_todos DROP COLUMN context;");
}
