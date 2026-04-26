import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "030_stream_events_cleanup";
export const managesTransaction = true;

export function up(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      // Only rebuild if conversation_id exists AND task_id still exists (not yet cleaned)
      if (
        hasTable(db, "stream_events") &&
        hasColumn(db, "stream_events", "conversation_id") &&
        hasColumn(db, "stream_events", "task_id")
      ) {
        db.exec("DROP TABLE IF EXISTS stream_events_new");
        db.exec(
          "CREATE TABLE stream_events_new (" +
            "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  conversation_id INTEGER NOT NULL," +
            "  execution_id    INTEGER NOT NULL," +
            "  seq             INTEGER NOT NULL," +
            "  block_id        TEXT NOT NULL," +
            "  type            TEXT NOT NULL," +
            "  content         TEXT NOT NULL DEFAULT ''," +
            "  metadata        TEXT," +
            "  parent_block_id TEXT," +
            "  subagent_id     TEXT," +
            "  created_at      TEXT DEFAULT (datetime('now'))," +
            "  UNIQUE (conversation_id, seq)" +
            ")",
        );
        db.exec(
          "INSERT OR IGNORE INTO stream_events_new" +
            " (id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)" +
            " SELECT id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at" +
            " FROM stream_events" +
            " WHERE conversation_id IS NOT NULL",
        );
        db.exec("DROP TABLE stream_events");
        db.exec("ALTER TABLE stream_events_new RENAME TO stream_events");
        db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events(conversation_id, seq)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_execution ON stream_events(execution_id, seq)");
      }

      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
