import { Database } from "bun:sqlite";

export const id = "003_logs";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      level        TEXT    NOT NULL DEFAULT 'info',
      task_id      INTEGER,
      execution_id INTEGER,
      message      TEXT    NOT NULL,
      data         TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_task      ON logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_logs_execution ON logs(execution_id);
    CREATE INDEX IF NOT EXISTS idx_logs_level     ON logs(level);
    CREATE INDEX IF NOT EXISTS idx_logs_created   ON logs(created_at);
  `);
}
