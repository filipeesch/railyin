import { Database } from "bun:sqlite";
import { hasColumn } from "./_utils.ts";

export const id = "002_task_ux_improvements";

export function up(db: Database): void {
  if (!hasColumn(db, "tasks", "model")) {
    db.exec("ALTER TABLE tasks ADD COLUMN model TEXT");
  }
}
