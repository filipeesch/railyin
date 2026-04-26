import { Database } from "bun:sqlite";

export const id = "018_stream_events";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stream_events (
      id           INTEGER PRIMARY KEY,
      task_id      INTEGER NOT NULL,
      execution_id INTEGER NOT NULL,
      seq          INTEGER NOT NULL,
      block_id     TEXT NOT NULL,
      type         TEXT NOT NULL,
      content      TEXT NOT NULL DEFAULT '',
      metadata     TEXT,
      parent_block_id TEXT,
      subagent_id  TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (task_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_stream_events_task ON stream_events (task_id, seq);
  `);
}
