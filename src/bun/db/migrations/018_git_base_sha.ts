import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "018_git_base_sha";

export function up(db: Database): void {
  if (hasTable(db, "task_git_context") && !hasColumn(db, "task_git_context", "base_sha")) {
    db.exec("ALTER TABLE task_git_context ADD COLUMN base_sha TEXT");
  }
}
