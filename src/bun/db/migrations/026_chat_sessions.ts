import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "026_chat_sessions";
export const managesTransaction = true;

export function up(db: Database): void {
  // PRAGMA foreign_keys must be set outside a transaction (tasks.conversation_id → conversations).
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    // Use BEGIN IMMEDIATE to acquire the write lock upfront.
    // In WAL mode, db.transaction() uses BEGIN DEFERRED, which acquires the lock lazily
    // on the first actual write. When all early guards are no-ops the first write can
    // be the backfill UPDATE deep in the migration, causing a late SQLITE_BUSY timeout.
    db.exec("BEGIN IMMEDIATE");
    try {
      // 1. Make conversations.task_id nullable and add fork columns.
      //    Only needed when task_id is currently NOT NULL (fresh DB from migration 001).
      //    Drop any leftover _new table from a previously interrupted run.
      db.exec("DROP TABLE IF EXISTS conversations_new");
      const convCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(conversations)").all();
      const taskIdNotNull = convCols.find((c) => c.name === "task_id")?.notnull === 1;
      if (taskIdNotNull) {
        db.exec(
          "CREATE TABLE conversations_new (" +
            "  id                     INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  task_id                INTEGER NULL," +
            "  parent_conversation_id INTEGER NULL," +
            "  forked_at_message_id   INTEGER NULL" +
            ")",
        );
        db.exec("INSERT INTO conversations_new (id, task_id) SELECT id, task_id FROM conversations");
        db.exec("DROP TABLE conversations");
        db.exec("ALTER TABLE conversations_new RENAME TO conversations");
      } else if (hasTable(db, "conversations") && !hasColumn(db, "conversations", "parent_conversation_id")) {
        // task_id already nullable but fork columns missing — add them
        db.exec("ALTER TABLE conversations ADD COLUMN parent_conversation_id INTEGER NULL");
        db.exec("ALTER TABLE conversations ADD COLUMN forked_at_message_id INTEGER NULL");
      }

      // 2. Add conversation_id to stream_events (one statement per exec)
      if (hasTable(db, "stream_events") && !hasColumn(db, "stream_events", "conversation_id")) {
        // No REFERENCES clause here — SQLite validates FK targets in ADD COLUMN even with
        // foreign_keys=OFF, and conversations may not exist in partial-schema environments.
        db.exec("ALTER TABLE stream_events ADD COLUMN conversation_id INTEGER NULL");
      }

      // 3. Backfill stream_events.conversation_id from task_id join
      if (
        hasTable(db, "stream_events") &&
        hasColumn(db, "stream_events", "conversation_id") &&
        hasTable(db, "conversations")
      ) {
        db.exec(
          "UPDATE stream_events" +
            " SET conversation_id = (SELECT c.id FROM conversations c WHERE c.task_id = stream_events.task_id)" +
            " WHERE task_id IS NOT NULL AND conversation_id IS NULL",
        );
      }

      // 4. Make conversation_messages.task_id nullable if currently NOT NULL
      db.exec("DROP TABLE IF EXISTS conversation_messages_new");
      const msgCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(conversation_messages)").all();
      const msgTaskIdNotNull = msgCols.find((c) => c.name === "task_id")?.notnull === 1;
      if (msgTaskIdNotNull) {
        db.exec(
          "CREATE TABLE conversation_messages_new (" +
            "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  task_id         INTEGER NULL," +
            "  conversation_id INTEGER NOT NULL REFERENCES conversations(id)," +
            "  type            TEXT NOT NULL," +
            "  role            TEXT," +
            "  content         TEXT NOT NULL," +
            "  metadata        TEXT," +
            "  created_at      TEXT NOT NULL DEFAULT (datetime('now'))" +
            ")",
        );
        db.exec(
          "INSERT INTO conversation_messages_new" +
            " (id, task_id, conversation_id, type, role, content, metadata, created_at)" +
            " SELECT id, task_id, conversation_id, type, role, content, metadata, created_at" +
            " FROM conversation_messages",
        );
        db.exec("DROP TABLE conversation_messages");
        db.exec("ALTER TABLE conversation_messages_new RENAME TO conversation_messages");
      }

      // 5. Create chat_sessions table
      if (hasTable(db, "conversations")) {
        db.exec(
          "CREATE TABLE IF NOT EXISTS chat_sessions (" +
            "  id               INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  workspace_key    TEXT    NOT NULL," +
            "  title            TEXT    NOT NULL," +
            "  status           TEXT    NOT NULL DEFAULT 'idle'," +
            "  conversation_id  INTEGER NOT NULL UNIQUE REFERENCES conversations(id)," +
            "  last_activity_at TEXT    NOT NULL DEFAULT (datetime('now'))," +
            "  last_read_at     TEXT    NULL," +
            "  archived_at      TEXT    NULL," +
            "  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))" +
            ")",
        );
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_activity ON chat_sessions(workspace_key, last_activity_at DESC)",
        );
      }

      // 6. Index on stream_events(conversation_id)
      if (hasTable(db, "stream_events") && hasColumn(db, "stream_events", "conversation_id")) {
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events(conversation_id, seq)",
        );
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
