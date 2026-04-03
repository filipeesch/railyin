import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, _resetForTests as resetDbSingleton } from "../db/index.ts";
import { resetConfig, loadConfig } from "../config/index.ts";

// ─── In-memory DB ─────────────────────────────────────────────────────────────

export function initDb(): Database {
  process.env.RAILYN_DB = ":memory:";
  resetDbSingleton();
  const db = getDb();
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id    INTEGER NOT NULL REFERENCES workspaces(id),
      name            TEXT NOT NULL,
      project_path    TEXT NOT NULL,
      git_root_path   TEXT NOT NULL,
      default_branch  TEXT NOT NULL DEFAULT 'main',
      slug            TEXT,
      description     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS boards (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id         INTEGER NOT NULL REFERENCES workspaces(id),
      name                 TEXT NOT NULL,
      workflow_template_id TEXT NOT NULL,
      project_ids          TEXT NOT NULL DEFAULT '[]',
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id                  INTEGER NOT NULL REFERENCES boards(id),
      project_id                INTEGER NOT NULL REFERENCES projects(id),
      title                     TEXT NOT NULL,
      description               TEXT NOT NULL DEFAULT '',
      workflow_state            TEXT NOT NULL DEFAULT 'backlog',
      execution_state           TEXT NOT NULL DEFAULT 'idle',
      conversation_id           INTEGER REFERENCES conversations(id),
      current_execution_id      INTEGER,
      retry_count               INTEGER NOT NULL DEFAULT 0,
      created_from_task_id      INTEGER REFERENCES tasks(id),
      created_from_execution_id INTEGER,
      created_at                TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_git_context (
      task_id         INTEGER PRIMARY KEY REFERENCES tasks(id),
      git_root_path   TEXT NOT NULL,
      subrepo_path    TEXT,
      branch_name     TEXT,
      worktree_path   TEXT,
      worktree_status TEXT NOT NULL DEFAULT 'not_created'
    );
    CREATE TABLE IF NOT EXISTS executions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES tasks(id),
      from_state  TEXT NOT NULL,
      to_state    TEXT NOT NULL,
      prompt_id   TEXT,
      status      TEXT NOT NULL DEFAULT 'running',
      attempt     INTEGER NOT NULL DEFAULT 1,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      summary     TEXT,
      details     TEXT
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER NOT NULL REFERENCES tasks(id),
      conversation_id INTEGER NOT NULL REFERENCES conversations(id),
      type            TEXT NOT NULL,
      role            TEXT,
      content         TEXT NOT NULL DEFAULT '',
      metadata        TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.run("INSERT INTO workspaces (id, name) VALUES (1, 'test-workspace')");
  return db;
}

// ─── Temp directory fixture ───────────────────────────────────────────────────

export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "railyn-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ─── Seed a project + board + task ───────────────────────────────────────────

export function seedProjectAndTask(
  db: Database,
  gitRootPath: string,
): { projectId: number; boardId: number; taskId: number; conversationId: number } {
  db.run(
    "INSERT INTO projects (workspace_id, name, project_path, git_root_path, default_branch) VALUES (1, 'test', ?, ?, 'main')",
    [gitRootPath, gitRootPath],
  );
  const projectId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  db.run("INSERT INTO boards (workspace_id, name, workflow_template_id) VALUES (1, 'test-board', 'delivery')");
  const boardId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  db.run(
    "INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state, conversation_id) VALUES (?, ?, 'Test task', 'A test task', 'plan', 'idle', ?)",
    [boardId, projectId, conversationId],
  );
  const taskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
  db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

  return { projectId, boardId, taskId, conversationId };
}

// ─── Minimal config for tests (provider: fake) ───────────────────────────────

export function setupTestConfig(extraYaml = ""): { configDir: string; cleanup: () => void } {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));

  writeFileSync(
    join(configDir, "workspace.yaml"),
    [
      "name: test",
      "ai:",
      "  provider: fake",
      '  base_url: ""',
      '  api_key: ""',
      "  model: fake",
      "  context_window_tokens: 128000",
      extraYaml,
    ].join("\n") + "\n",
  );

  writeFileSync(
    join(configDir, "workflows.yaml"),
    `- id: delivery
  name: Delivery
  columns:
    - id: backlog
      label: Backlog
      is_backlog: true
    - id: plan
      label: Plan
      on_enter_prompt: "Plan the task."
      stage_instructions: "You are a planning assistant."
      allowed_transitions: [inprogress]
    - id: done
      label: Done
`,
  );

  process.env.RAILYN_CONFIG_DIR = configDir;
  resetConfig();
  loadConfig();

  return {
    configDir,
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      resetConfig();
    },
  };
}
