import { Database } from "bun:sqlite";
import { hasTable } from "./_utils.ts";

export const id = "022_drop_workspace_project_fks";
export const managesTransaction = true;

export function up(db: Database): void {
  // PRAGMA foreign_keys must be set outside a transaction per SQLite docs.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // Recreate boards without the workspace FK (one statement per exec for safety)
      db.exec(
        "CREATE TABLE IF NOT EXISTS boards_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  workspace_id INTEGER NOT NULL," +
          "  name TEXT NOT NULL," +
          "  workflow_template_id TEXT NOT NULL," +
          "  project_ids TEXT NOT NULL DEFAULT '[]'," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
          ")",
      );
      if (hasTable(db, "boards")) {
        db.exec(
          "INSERT OR IGNORE INTO boards_new (id, workspace_id, name, workflow_template_id, project_ids, created_at)" +
            " SELECT id, workspace_id, name, workflow_template_id, project_ids, created_at FROM boards",
        );
        db.exec("DROP TABLE IF EXISTS boards");
      }
      db.exec("ALTER TABLE boards_new RENAME TO boards");

      // Recreate tasks without the project FK
      db.exec(
        "CREATE TABLE IF NOT EXISTS tasks_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  board_id INTEGER NOT NULL REFERENCES boards(id)," +
          "  project_id INTEGER NOT NULL," +
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
          "  model TEXT," +
          "  shell_auto_approve INTEGER NOT NULL DEFAULT 0," +
          "  approved_commands TEXT NOT NULL DEFAULT '[]'," +
          "  position REAL NOT NULL DEFAULT 0" +
          ")",
      );
      if (hasTable(db, "tasks")) {
        db.exec(
          "INSERT OR IGNORE INTO tasks_new" +
            " (id, board_id, project_id, title, description, workflow_state, execution_state," +
            "  conversation_id, current_execution_id, retry_count, created_from_task_id," +
            "  created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position)" +
            " SELECT id, board_id, project_id, title, description, workflow_state, execution_state," +
            "        conversation_id, current_execution_id, retry_count, created_from_task_id," +
            "        created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position" +
            " FROM tasks",
        );
        db.exec("DROP TABLE IF EXISTS tasks");
      }
      db.exec("ALTER TABLE tasks_new RENAME TO tasks");

      db.exec("DROP TABLE IF EXISTS workspaces");
      db.exec("DROP TABLE IF EXISTS projects");
      db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
