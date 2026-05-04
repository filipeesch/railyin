import type { Database } from "bun:sqlite";
import { hasColumn } from "./_utils.ts";

export const id = "037_remove_model_from_tasks";
// Must manage its own transaction so we can toggle PRAGMA foreign_keys
// (SQLite forbids changing it inside an active transaction).
export const managesTransaction = true;
// Original version skipped PRAGMA foreign_keys = OFF and used a dynamic
// PRAGMA table_info approach that also dropped DEFAULT (datetime('now')).
// Listed here so databases that ran the old version don't get a checksum-
// mismatch error when this fixed version is deployed.
export const previousChecksums = [
  "ff09dd18e2e49e937ae505b9cc04d00f2b9977c61e254f80934d986292e3a1f0",
];

export function up(db: Database): void {
  // If the model column is already gone, just record migration as applied.
  if (!hasColumn(db, "tasks", "model")) {
    db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    return;
  }

  // PRAGMA foreign_keys must be OFF before any DDL that drops/renames tables
  // that other tables reference — otherwise SQLite raises a FK constraint error.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Recreate tasks table without the model column.
      // Columns are listed explicitly to preserve all defaults (including
      // function-call defaults like DEFAULT (datetime('now'))) and FK references.
      db.exec(
        "CREATE TABLE IF NOT EXISTS tasks_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  board_id INTEGER NOT NULL REFERENCES boards(id)," +
          "  project_key TEXT NOT NULL DEFAULT 'unknown'," +
          "  title TEXT NOT NULL," +
          "  description TEXT NOT NULL DEFAULT ''," +
          "  workflow_state TEXT NOT NULL DEFAULT 'backlog'," +
          "  execution_state TEXT NOT NULL DEFAULT 'idle'," +
          "  conversation_id INTEGER REFERENCES conversations(id)," +
          "  current_execution_id INTEGER," +
          "  retry_count INTEGER NOT NULL DEFAULT 0," +
          "  created_from_task_id INTEGER," +
          "  created_from_execution_id INTEGER," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
          "  shell_auto_approve INTEGER NOT NULL DEFAULT 0," +
          "  approved_commands TEXT NOT NULL DEFAULT '[]'," +
          "  position REAL NOT NULL DEFAULT 0," +
          "  needs_column_prompt INTEGER NOT NULL DEFAULT 0" +
          ")",
      );

      db.exec(
        "INSERT INTO tasks_new" +
          " (id, board_id, project_key, title, description, workflow_state, execution_state," +
          "  conversation_id, current_execution_id, retry_count, created_from_task_id," +
          "  created_from_execution_id, created_at, shell_auto_approve, approved_commands," +
          "  position, needs_column_prompt)" +
          " SELECT" +
          "  id, board_id, project_key, title, description, workflow_state, execution_state," +
          "  conversation_id, current_execution_id, retry_count, created_from_task_id," +
          "  created_from_execution_id, created_at, shell_auto_approve, approved_commands," +
          "  position, needs_column_prompt" +
          " FROM tasks",
      );

      db.exec("DROP TABLE tasks");
      db.exec("ALTER TABLE tasks_new RENAME TO tasks");

      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function down(db: Database): void {
  // To restore the model column, we need to recreate the table with it
  // This is the reverse of the up migration

  // Get the current schema of tasks table
  const tableInfo = db.query<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }, []>(
    "PRAGMA table_info(tasks)"
  ).all();

  // Build column definitions for the new table (including model column)
  const columnDefs: string[] = [];
  for (const col of tableInfo) {
    let colDef = `${col.name} ${col.type}`;

    if (col.notnull === 1) {
      colDef += " NOT NULL";
    }

    // Only add DEFAULT if it's not a function call (which would have parentheses)
    if (col.dflt_value !== null && !col.dflt_value.includes('(')) {
      colDef += ` DEFAULT ${col.dflt_value}`;
    }

    if (col.pk === 1) {
      if (col.type.toUpperCase() === "INTEGER") {
        colDef += " PRIMARY KEY AUTOINCREMENT";
      } else {
        colDef += " PRIMARY KEY";
      }
    }

    columnDefs.push(colDef);
  }

  // Add the model column at the end
  columnDefs.push("model TEXT");

  const columnsSql = columnDefs.join(", ");

  // Create new table with model column
  db.exec(`CREATE TABLE tasks_new (${columnsSql})`);

  // Copy data from old table to new table
  const columnNames = tableInfo
    .map(col => col.name)
    .join(", ");

  db.exec(`INSERT INTO tasks_new (${columnNames}) SELECT ${columnNames} FROM tasks`);

  // Drop old table and rename new table
  db.exec("DROP TABLE tasks");
  db.exec("ALTER TABLE tasks_new RENAME TO tasks");
}
