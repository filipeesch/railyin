import { Database } from "bun:sqlite";

export const id = "021_model_raw_messages";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_raw_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      execution_id    INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      engine          TEXT    NOT NULL,
      session_id      TEXT,
      stream_seq      INTEGER NOT NULL,
      direction       TEXT    NOT NULL,
      event_type      TEXT    NOT NULL,
      event_subtype   TEXT,
      payload_json    TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_model_raw_messages_execution_seq
      ON model_raw_messages (execution_id, stream_seq);
    CREATE INDEX IF NOT EXISTS idx_model_raw_messages_task_created
      ON model_raw_messages (task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_raw_messages_engine_type
      ON model_raw_messages (engine, event_type);
  `);
}
