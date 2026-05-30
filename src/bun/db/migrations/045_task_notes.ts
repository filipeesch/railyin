import type { Database } from "bun:sqlite";

export const id = "045_task_notes";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      title           TEXT,
      content         TEXT    NOT NULL,
      is_source_ai    INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_task_notes_conversation
      ON task_notes(conversation_id);
  `);
}

export function down(db: Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_task_notes_conversation;
    DROP TABLE IF EXISTS task_notes;
  `);
}
