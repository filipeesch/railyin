import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "029_conversation_stream_cleanup";
export const managesTransaction = true;

export function up(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (hasTable(db, "tasks") && hasColumn(db, "tasks", "conversation_id") && hasTable(db, "conversations")) {
        db.exec(
          "UPDATE tasks" +
            " SET conversation_id = (" +
            "  SELECT c.id FROM conversations c WHERE c.task_id = tasks.id ORDER BY c.id ASC LIMIT 1" +
            " )" +
            " WHERE conversation_id IS NULL",
        );
      }

      if (hasTable(db, "executions") && hasColumn(db, "executions", "conversation_id") && hasTable(db, "tasks")) {
        db.exec(
          "UPDATE executions" +
            " SET conversation_id = (" +
            "  SELECT t.conversation_id FROM tasks t WHERE t.id = executions.task_id" +
            " )" +
            " WHERE task_id IS NOT NULL AND conversation_id IS NULL",
        );
      }

      if (hasTable(db, "stream_events")) {
        if (!hasColumn(db, "stream_events", "conversation_id")) {
          db.exec("ALTER TABLE stream_events ADD COLUMN conversation_id INTEGER NULL");
        }

        db.exec(
          "UPDATE stream_events" +
            " SET conversation_id = (" +
            "  SELECT e.conversation_id FROM executions e WHERE e.id = stream_events.execution_id" +
            " )" +
            " WHERE conversation_id IS NULL",
        );

        if (hasTable(db, "tasks")) {
          db.exec(
            "UPDATE stream_events" +
              " SET conversation_id = (" +
              "  SELECT t.conversation_id FROM tasks t WHERE t.id = stream_events.task_id" +
              " )" +
              " WHERE conversation_id IS NULL AND task_id IS NOT NULL",
          );
        }

        db.exec("DROP TABLE IF EXISTS stream_events_new");
        db.exec(
          "CREATE TABLE stream_events_new (" +
            "  id              INTEGER PRIMARY KEY," +
            "  task_id         INTEGER NULL REFERENCES tasks(id)," +
            "  conversation_id INTEGER NULL REFERENCES conversations(id)," +
            "  execution_id    INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE," +
            "  seq             INTEGER NOT NULL," +
            "  block_id        TEXT NOT NULL," +
            "  type            TEXT NOT NULL," +
            "  content         TEXT NOT NULL DEFAULT ''," +
            "  metadata        TEXT," +
            "  parent_block_id TEXT," +
            "  subagent_id     TEXT," +
            "  created_at      TEXT NOT NULL DEFAULT (datetime('now'))," +
            "  UNIQUE (execution_id, seq)" +
            ")",
        );
        db.exec(
          "INSERT OR IGNORE INTO stream_events_new" +
            " (id, task_id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)" +
            " SELECT id, task_id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at" +
            " FROM stream_events" +
            " WHERE conversation_id IS NOT NULL",
        );
        db.exec("DROP TABLE stream_events");
        db.exec("ALTER TABLE stream_events_new RENAME TO stream_events");
        db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_task ON stream_events(task_id, seq)");
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
