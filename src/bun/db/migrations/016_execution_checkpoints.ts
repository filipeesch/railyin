import { Database } from "bun:sqlite";

export const id = "016_execution_checkpoints";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_execution_checkpoints (
      execution_id INTEGER PRIMARY KEY REFERENCES executions(id),
      stash_ref    TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
