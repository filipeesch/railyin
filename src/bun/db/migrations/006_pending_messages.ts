import { Database } from "bun:sqlite";

export const id = "006_pending_messages";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pending_messages_task ON pending_messages(task_id);
  `);
}
