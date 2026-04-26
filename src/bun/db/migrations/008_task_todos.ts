import { Database } from "bun:sqlite";

export const id = "008_task_todos";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_todos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'not-started',
      context    TEXT,
      result     TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_todos_task ON task_todos(task_id);
  `);
}
