import { Database } from "bun:sqlite";
import { hasTable } from "./_utils.ts";

export const id = "048_chat_cascade";
export const managesTransaction = true;

export function up(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      // 1. Recreate conversation_messages with ON DELETE CASCADE on conversation_id
      db.exec("DROP TABLE IF EXISTS conversation_messages_new");
      db.exec(
        "CREATE TABLE conversation_messages_new (" +
          "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  task_id         INTEGER NULL," +
          "  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE," +
          "  type            TEXT NOT NULL," +
          "  role            TEXT," +
          "  content         TEXT NOT NULL DEFAULT ''," +
          "  metadata        TEXT," +
          "  created_at      TEXT NOT NULL DEFAULT (datetime('now'))" +
          ")",
      );
      if (hasTable(db, "conversation_messages")) {
        db.exec(
          "INSERT INTO conversation_messages_new" +
            " (id, task_id, conversation_id, type, role, content, metadata, created_at)" +
            " SELECT id, task_id, conversation_id, type, role, content, metadata, created_at" +
            " FROM conversation_messages",
        );
        db.exec("DROP TABLE conversation_messages");
      }
      db.exec("ALTER TABLE conversation_messages_new RENAME TO conversation_messages");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation" +
          " ON conversation_messages(conversation_id)",
      );

      // 2. Recreate stream_events with ON DELETE CASCADE on conversation_id
      db.exec("DROP TABLE IF EXISTS stream_events_new");
      db.exec(
        "CREATE TABLE stream_events_new (" +
          "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE," +
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
      if (hasTable(db, "stream_events")) {
        db.exec(
          "INSERT OR IGNORE INTO stream_events_new" +
            " (id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)" +
            " SELECT id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at" +
            " FROM stream_events",
        );
        db.exec("DROP TABLE stream_events");
      }
      db.exec("ALTER TABLE stream_events_new RENAME TO stream_events");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events(conversation_id, seq)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_stream_events_execution ON stream_events(execution_id, seq)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_stream_events_conv_exec_seq" +
          " ON stream_events(conversation_id, execution_id, seq)",
      );

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
