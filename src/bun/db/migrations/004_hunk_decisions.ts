import { Database } from "bun:sqlite";

export const id = "004_hunk_decisions";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_hunk_decisions (
      task_id        INTEGER NOT NULL REFERENCES tasks(id),
      hunk_hash      TEXT    NOT NULL,
      file_path      TEXT    NOT NULL,
      reviewer_type  TEXT    NOT NULL DEFAULT 'human',
      reviewer_id    TEXT    NOT NULL DEFAULT 'user',
      decision       TEXT    NOT NULL DEFAULT 'pending',
      comment        TEXT,
      original_start INTEGER NOT NULL DEFAULT 0,
      modified_start INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, hunk_hash, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hunk_decisions_task ON task_hunk_decisions(task_id);
  `);
}
