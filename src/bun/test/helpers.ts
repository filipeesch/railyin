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
      name TEXT NOT NULL,
      config_key TEXT
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
      model                     TEXT,
      shell_auto_approve        INTEGER NOT NULL DEFAULT 0,
      approved_commands         TEXT    NOT NULL DEFAULT '[]',
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
      details     TEXT,
      cost_estimate REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER
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
    CREATE TABLE IF NOT EXISTS logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      level        TEXT    NOT NULL DEFAULT 'info',
      task_id      INTEGER,
      execution_id INTEGER,
      message      TEXT    NOT NULL,
      data         TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_hunk_decisions (
      task_id        INTEGER NOT NULL REFERENCES tasks(id),
      hunk_hash      TEXT    NOT NULL,
      file_path      TEXT    NOT NULL,
      reviewer_type  TEXT    NOT NULL DEFAULT 'human',
      reviewer_id    TEXT    NOT NULL DEFAULT 'user',
      decision       TEXT    NOT NULL DEFAULT 'pending',
      comment        TEXT,
      original_start INTEGER NOT NULL DEFAULT 0,
      original_end   INTEGER NOT NULL DEFAULT 0,
      modified_start INTEGER NOT NULL DEFAULT 0,
      modified_end   INTEGER NOT NULL DEFAULT 0,
      sent           INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, hunk_hash, reviewer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hunk_decisions_task ON task_hunk_decisions(task_id);
    CREATE TABLE IF NOT EXISTS task_line_comments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_path     TEXT    NOT NULL,
      line_start    INTEGER NOT NULL,
      line_end      INTEGER NOT NULL,
      line_text     TEXT    NOT NULL,
      context_lines TEXT,
      comment       TEXT    NOT NULL,
      reviewer_type TEXT    NOT NULL DEFAULT 'human',
      sent          INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_line_comments_task ON task_line_comments(task_id);
    CREATE TABLE IF NOT EXISTS enabled_models (
      workspace_id        INTEGER NOT NULL,
      qualified_model_id  TEXT    NOT NULL,
      PRIMARY KEY (workspace_id, qualified_model_id)
    );
    CREATE TABLE IF NOT EXISTS pending_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_todos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'not-started',
      context    TEXT,
      result     TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_todos_task ON task_todos(task_id);
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
  db.run("INSERT INTO workspaces (id, name, config_key) VALUES (1, 'test-workspace', 'default')");
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
    "INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state, conversation_id, model) VALUES (?, ?, 'Test task', 'A test task', 'plan', 'idle', ?, 'fake/fake')",
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
    join(configDir, "workspace.test.yaml"),
    [
      "name: test",
      "projects:",
      "  - key: test-project",
      "    name: Test Project",
      "    project_path: /tmp/test-git",
      "    git_root_path: /tmp/test-git",
      "    default_branch: main",
      "providers:",
      "  - id: fake",
      "    type: fake",
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
  process.env.RAILYN_SESSION_MEMORY_DIR = join(configDir, "tasks");
  resetConfig();
  loadConfig();

  return {
    configDir,
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_SESSION_MEMORY_DIR;
      resetConfig();
    },
  };
}
