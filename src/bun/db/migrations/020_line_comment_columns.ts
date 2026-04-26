import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "020_line_comment_columns";

export function up(db: Database): void {
  if (hasTable(db, "task_line_comments") && !hasColumn(db, "task_line_comments", "col_start")) {
    db.exec("ALTER TABLE task_line_comments ADD COLUMN col_start INTEGER NOT NULL DEFAULT 0");
  }
  if (hasTable(db, "task_line_comments") && !hasColumn(db, "task_line_comments", "col_end")) {
    db.exec("ALTER TABLE task_line_comments ADD COLUMN col_end INTEGER NOT NULL DEFAULT 0");
  }
}
