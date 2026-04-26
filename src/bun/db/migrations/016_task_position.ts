import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "016_task_position";

export function up(db: Database): void {
  if (hasTable(db, "tasks") && !hasColumn(db, "tasks", "position")) {
    db.exec("ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0");
  }
}
