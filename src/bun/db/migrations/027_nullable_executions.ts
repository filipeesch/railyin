import { Database } from "bun:sqlite";
import { hasColumn, hasTable } from "./_utils.ts";

export const id = "027_nullable_executions";
export const managesTransaction = true;

export function up(db: Database): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      // 1. Make executions.task_id nullable and add conversation_id column
      if (hasTable(db, "executions")) {
        db.exec("DROP TABLE IF EXISTS executions_new");
        const execCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(executions)").all();
        const execTaskIdNotNull = execCols.find((c) => c.name === "task_id")?.notnull === 1;
        if (execTaskIdNotNull || !execCols.some((c) => c.name === "conversation_id")) {
          db.exec(
            "CREATE TABLE executions_new (" +
              "  id                           INTEGER PRIMARY KEY AUTOINCREMENT," +
              "  task_id                      INTEGER NULL," +
              "  conversation_id              INTEGER NULL," +
              "  from_state                   TEXT    NOT NULL DEFAULT ''," +
              "  to_state                     TEXT    NOT NULL DEFAULT ''," +
              "  prompt_id                    TEXT," +
              "  status                       TEXT    NOT NULL DEFAULT 'running'," +
              "  attempt                      INTEGER NOT NULL DEFAULT 1," +
              "  started_at                   TEXT    NOT NULL DEFAULT (datetime('now'))," +
              "  finished_at                  TEXT," +
              "  summary                      TEXT," +
              "  details                      TEXT," +
              "  cost_estimate                REAL," +
              "  input_tokens                 INTEGER," +
              "  output_tokens                INTEGER," +
              "  cache_creation_input_tokens  INTEGER," +
              "  cache_read_input_tokens      INTEGER" +
              ")",
          );
          db.exec(
            "INSERT INTO executions_new (id, task_id, from_state, to_state, prompt_id, status, attempt, started_at, finished_at, summary, details, cost_estimate, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)" +
              " SELECT id, task_id, from_state, to_state, prompt_id, status, attempt, started_at, finished_at, summary, details, cost_estimate, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens FROM executions",
          );
          db.exec(
            "UPDATE executions_new SET conversation_id = (" +
              "  SELECT t.conversation_id FROM tasks t WHERE t.id = executions_new.task_id" +
              ") WHERE task_id IS NOT NULL",
          );
          db.exec("DROP TABLE executions");
          db.exec("ALTER TABLE executions_new RENAME TO executions");
          db.exec("CREATE INDEX IF NOT EXISTS idx_executions_task ON executions(task_id)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_executions_conversation ON executions(conversation_id)");
        }
      }

      // 2. Make model_raw_messages.task_id nullable
      if (hasTable(db, "model_raw_messages")) {
        db.exec("DROP TABLE IF EXISTS model_raw_messages_new");
        const rawCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(model_raw_messages)").all();
        const rawTaskIdNotNull = rawCols.find((c) => c.name === "task_id")?.notnull === 1;
        if (rawTaskIdNotNull) {
          db.exec(
            "CREATE TABLE model_raw_messages_new (" +
              "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
              "  task_id         INTEGER NULL," +
              "  execution_id    INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE," +
              "  engine          TEXT    NOT NULL," +
              "  session_id      TEXT," +
              "  stream_seq      INTEGER NOT NULL," +
              "  direction       TEXT    NOT NULL," +
              "  event_type      TEXT    NOT NULL," +
              "  event_subtype   TEXT," +
              "  payload_json    TEXT    NOT NULL," +
              "  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))" +
              ")",
          );
          db.exec(
            "INSERT INTO model_raw_messages_new" +
              " (id, task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at)" +
              " SELECT id, task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at" +
              " FROM model_raw_messages",
          );
          db.exec("DROP TABLE model_raw_messages");
          db.exec("ALTER TABLE model_raw_messages_new RENAME TO model_raw_messages");
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_model_raw_messages_execution_seq ON model_raw_messages (execution_id, stream_seq)",
          );
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_model_raw_messages_task_created ON model_raw_messages (task_id, created_at)",
          );
          db.exec(
            "CREATE INDEX IF NOT EXISTS idx_model_raw_messages_engine_type ON model_raw_messages (engine, event_type)",
          );
        }
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
