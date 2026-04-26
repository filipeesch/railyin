import { Database } from "bun:sqlite";

export const id = "007_line_comments";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_line_comments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_path     TEXT    NOT NULL,
      line_start    INTEGER NOT NULL,
      line_end      INTEGER NOT NULL,
      line_text     TEXT    NOT NULL DEFAULT '[]',
      context_lines TEXT    NOT NULL DEFAULT '[]',
      comment       TEXT    NOT NULL,
      reviewer_id   TEXT    NOT NULL DEFAULT 'user',
      reviewer_type TEXT    NOT NULL DEFAULT 'human',
      sent          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_line_comments_task_file_sent ON task_line_comments(task_id, file_path, sent);
  `);
}
