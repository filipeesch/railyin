import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { hasTable } from "./_utils.ts";
import { getWorkspaceRegistry, loadConfig, getConfig } from "../../config/index.ts";

export const id = "023_text_keys";
export const managesTransaction = true;

export function up(db: Database): void {
  const _stableId = (seed: string): number => {
    const hex = createHash("sha1").update(seed).digest("hex").slice(0, 12);
    return parseInt(hex, 16);
  };
  const _wsNumericId = (key: string): number =>
    key === "default" ? 1 : _stableId(`workspace:${key}`);
  const _projNumericId = (wsKey: string, projKey: string): number =>
    _stableId(`project:${wsKey}:${projKey}`);

  const registry = getWorkspaceRegistry();
  const wsIdToKey = new Map<number, string>();
  for (const entry of registry) {
    wsIdToKey.set(_wsNumericId(entry.key), entry.key);
  }

  const projIdToKey = new Map<number, string>();
  for (const entry of registry) {
    try {
      const config = loadConfig(entry.key).config ?? getConfig(entry.key);
      for (const proj of config.projects) {
        projIdToKey.set(_projNumericId(entry.key, proj.key), proj.key);
      }
    } catch { /* ignore missing configs */ }
  }

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      // 1. Recreate boards with workspace_key TEXT
      db.exec(
        "CREATE TABLE IF NOT EXISTS boards_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  workspace_key TEXT NOT NULL DEFAULT 'default'," +
          "  name TEXT NOT NULL," +
          "  workflow_template_id TEXT NOT NULL," +
          "  project_keys TEXT NOT NULL DEFAULT '[]'," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
          ")",
      );
      if (hasTable(db, "boards")) {
        const boardRows = db.query<{
          id: number; workspace_id: number; name: string;
          workflow_template_id: string; project_ids: string; created_at: string;
        }, []>("SELECT id, workspace_id, name, workflow_template_id, project_ids, created_at FROM boards").all();
        for (const row of boardRows) {
          const wsKey = wsIdToKey.get(row.workspace_id) ?? "default";
          let projectKeys: string[] = [];
          try {
            const numericIds: number[] = JSON.parse(row.project_ids);
            projectKeys = numericIds.map((pid) => projIdToKey.get(pid) ?? String(pid));
          } catch { /* leave empty */ }
          db.run(
            "INSERT OR IGNORE INTO boards_new (id, workspace_key, name, workflow_template_id, project_keys, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [row.id, wsKey, row.name, row.workflow_template_id, JSON.stringify(projectKeys), row.created_at],
          );
        }
        db.exec("DROP TABLE IF EXISTS boards");
      }
      db.exec("ALTER TABLE boards_new RENAME TO boards");

      // 2. Recreate tasks with project_key TEXT
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
          "  model TEXT," +
          "  shell_auto_approve INTEGER NOT NULL DEFAULT 0," +
          "  approved_commands TEXT NOT NULL DEFAULT '[]'," +
          "  position REAL NOT NULL DEFAULT 0" +
          ")",
      );
      if (hasTable(db, "tasks")) {
        const taskRows = db.query<{
          id: number; board_id: number; project_id: number; title: string; description: string;
          workflow_state: string; execution_state: string; conversation_id: number | null;
          current_execution_id: number | null; retry_count: number;
          created_from_task_id: number | null; created_from_execution_id: number | null;
          created_at: string; model: string | null; shell_auto_approve: number;
          approved_commands: string; position: number;
        }, []>(
          "SELECT id, board_id, project_id, title, description, workflow_state, execution_state, conversation_id, current_execution_id, retry_count, created_from_task_id, created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position FROM tasks",
        ).all();
        for (const row of taskRows) {
          const projectKey = projIdToKey.get(row.project_id) ?? "unknown";
          db.run(
            "INSERT OR IGNORE INTO tasks_new (id, board_id, project_key, title, description, workflow_state, execution_state, conversation_id, current_execution_id, retry_count, created_from_task_id, created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [row.id, row.board_id, projectKey, row.title, row.description, row.workflow_state, row.execution_state, row.conversation_id, row.current_execution_id, row.retry_count, row.created_from_task_id, row.created_from_execution_id, row.created_at, row.model, row.shell_auto_approve, row.approved_commands, row.position],
          );
        }
        db.exec("DROP TABLE IF EXISTS tasks");
      }
      db.exec("ALTER TABLE tasks_new RENAME TO tasks");

      // 3. Recreate enabled_models with workspace_key TEXT
      db.exec(
        "CREATE TABLE IF NOT EXISTS enabled_models_new (" +
          "  workspace_key TEXT NOT NULL," +
          "  qualified_model_id TEXT NOT NULL," +
          "  PRIMARY KEY (workspace_key, qualified_model_id)" +
          ")",
      );
      if (hasTable(db, "enabled_models")) {
        const modelRows = db.query<{ workspace_id: number; qualified_model_id: string }, []>(
          "SELECT workspace_id, qualified_model_id FROM enabled_models",
        ).all();
        for (const row of modelRows) {
          const wsKey = wsIdToKey.get(row.workspace_id) ?? "default";
          db.run(
            "INSERT OR IGNORE INTO enabled_models_new (workspace_key, qualified_model_id) VALUES (?, ?)",
            [wsKey, row.qualified_model_id],
          );
        }
        db.exec("DROP TABLE IF EXISTS enabled_models");
      }
      db.exec("ALTER TABLE enabled_models_new RENAME TO enabled_models");

      db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_key)");
      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
    })();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
