import { Database } from "bun:sqlite";
import { hasTable } from "./_utils.ts";

export const id = "017_task_position_backfill";

export function up(db: Database): void {
  if (hasTable(db, "tasks")) {
    db.exec(`
      WITH ranked AS (
        SELECT id,
               (ROW_NUMBER() OVER (PARTITION BY board_id, workflow_state ORDER BY created_at)) * 1000.0 AS pos
        FROM tasks
      )
      UPDATE tasks SET position = (SELECT pos FROM ranked WHERE ranked.id = tasks.id);
    `);
  }
}
