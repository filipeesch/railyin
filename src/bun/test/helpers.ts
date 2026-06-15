import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { tmpdir } from "os";
import { getDb, _softResetForTests as resetDbSingleton } from "../db/index.ts";
import { resetConfig, loadConfig } from "../config/index.ts";

// ─── In-memory DB ─────────────────────────────────────────────────────────────

export function initDb(): Database {
  process.env.RAILYN_DB = ":memory:";
  resetDbSingleton();
  const db = getDb();
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_key        TEXT NOT NULL DEFAULT 'default',
      name                 TEXT NOT NULL,
      workflow_template_id TEXT NOT NULL,
      project_keys         TEXT NOT NULL DEFAULT '[]',
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversations (
       id      INTEGER PRIMARY KEY AUTOINCREMENT,
       task_id INTEGER,
       model   TEXT,
       last_engine_type TEXT NULL,
       decisions_injected_after_compaction_id INTEGER NULL,
       sampling_preset_override TEXT NULL
     );
    CREATE TABLE IF NOT EXISTS tasks (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id                  INTEGER NOT NULL REFERENCES boards(id),
      project_key               TEXT NOT NULL DEFAULT '',
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
      position                  REAL NOT NULL DEFAULT 0,
      needs_column_prompt       INTEGER NOT NULL DEFAULT 0,
      enabled_mcp_tools         TEXT    NULL,
      created_at                TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_git_context (
      task_id         INTEGER PRIMARY KEY REFERENCES tasks(id),
      git_root_path   TEXT NOT NULL,
      subrepo_path    TEXT,
      branch_name     TEXT,
      worktree_path   TEXT,
      worktree_status TEXT NOT NULL DEFAULT 'not_created',
      base_sha        TEXT
    );
    CREATE TABLE IF NOT EXISTS executions (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       task_id     INTEGER REFERENCES tasks(id),
        conversation_id INTEGER REFERENCES conversations(id),
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
       task_id         INTEGER REFERENCES tasks(id),
       conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
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
      col_start     INTEGER NOT NULL DEFAULT 0,
      col_end       INTEGER NOT NULL DEFAULT 0,
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
      workspace_key       TEXT    NOT NULL DEFAULT 'default',
      qualified_model_id  TEXT    NOT NULL,
      PRIMARY KEY (workspace_key, qualified_model_id)
    );
    CREATE TABLE IF NOT EXISTS pending_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_todos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      number      REAL    NOT NULL DEFAULT 0,
      title       TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      description TEXT    NOT NULL DEFAULT '',
      phase       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_todos_task ON task_todos(task_id);
    CREATE TABLE IF NOT EXISTS stream_events (
       id              INTEGER PRIMARY KEY AUTOINCREMENT,
       conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
       execution_id    INTEGER NOT NULL,
       seq             INTEGER NOT NULL,
       block_id        TEXT NOT NULL,
       type            TEXT NOT NULL,
       content         TEXT NOT NULL DEFAULT '',
       metadata        TEXT,
       parent_block_id TEXT,
       subagent_id     TEXT,
       created_at      TEXT DEFAULT (datetime('now')),
       UNIQUE (conversation_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events (conversation_id, seq);
    CREATE INDEX IF NOT EXISTS idx_stream_events_execution ON stream_events (execution_id, seq);
    CREATE TABLE IF NOT EXISTS task_execution_checkpoints (
      execution_id INTEGER PRIMARY KEY REFERENCES executions(id),
      stash_ref    TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_key    TEXT NOT NULL DEFAULT 'default',
      title            TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'idle',
      conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
      enabled_mcp_tools TEXT,
      shell_auto_approve INTEGER NOT NULL DEFAULT 0,
      approved_commands  TEXT NOT NULL DEFAULT '[]',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at      TEXT,
      last_read_at     TEXT
    );
    CREATE TABLE IF NOT EXISTS model_raw_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id         INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      execution_id    INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      engine          TEXT    NOT NULL,
      session_id      TEXT,
      stream_seq      INTEGER NOT NULL,
      direction       TEXT    NOT NULL,
      event_type      TEXT    NOT NULL,
      event_subtype   TEXT,
      payload_json    TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_model_raw_messages_execution_seq ON model_raw_messages (execution_id, stream_seq);
    CREATE INDEX IF NOT EXISTS idx_model_raw_messages_task_created ON model_raw_messages (task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_raw_messages_engine_type ON model_raw_messages (engine, event_type);
    CREATE TABLE IF NOT EXISTS decision_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS decision_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES decision_batches(id) ON DELETE SET NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      weight TEXT NOT NULL DEFAULT 'medium' CHECK (weight IN ('critical', 'medium', 'easy')),
      notes TEXT,
      revision_count INTEGER NOT NULL DEFAULT 0,
      is_source_ai INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS decision_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL REFERENCES decision_records(id) ON DELETE CASCADE,
      previous_answer TEXT NOT NULL,
      previous_notes TEXT,
      reason TEXT NOT NULL,
      revised_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_notes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      content         TEXT    NOT NULL,
      is_source_ai    INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS model_settings (
      workspace_key       TEXT    NOT NULL,
      qualified_model_id  TEXT    NOT NULL,
      context_window      INTEGER,
      PRIMARY KEY (workspace_key, qualified_model_id)
    );
    CREATE TABLE IF NOT EXISTS cursor_sessions (
      conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      agent_id        TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      last_used_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
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
  _gitRootPath: string,
): { projectKey: string; boardId: number; taskId: number; conversationId: number } {
  const projectKey = "test-project";

  db.run("INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ('default', 'test-board', 'delivery')");
  const boardId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  db.run(
    "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id, model) VALUES (?, ?, 'Test task', 'A test task', 'plan', 'idle', ?, 'fake/fake')",
    [boardId, projectKey, conversationId],
  );
  const taskId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
  db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

  return { projectKey, boardId, taskId, conversationId };
}

// ─── Minimal config for tests (provider: fake) ───────────────────────────────

const DEFAULT_WORKFLOWS_YAML = `id: delivery
name: Delivery
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
    on_enter_prompt: "Plan the task."
    stage_instructions: "You are a planning assistant."
  - id: done
    label: Done
`;

export function setupTestConfig(
  extraYaml = "",
  /** Absolute path to an existing project directory. When provided and the directory exists, its parent becomes the workspace_path and its basename becomes the relative project_path. When omitted or the directory does not exist, a workspace + project directory are created inside configDir. */
  gitRootPath?: string,
  /** Optional extra workflow template YAML strings (single-template format, NOT array). Each is written as its own file. */
  extraWorkflows: string[] = [],
  /** Override the default model. Pass null to omit the `default_model:` line entirely. Defaults to "copilot/mock-model". */
  defaultModel: string | null = "copilot/mock-model",
  /** Optional extra workspace YAML files to write alongside workspace.yaml. Each entry is written as workspace.<key>.yaml. */
  extraWorkspaces: { key: string; yaml: string }[] = [],
  /** Optional raw YAML content to write as `engines.yaml` in the config dir. When provided, this file takes precedence over the workspace.yaml `engine:` block. */
  enginesYaml?: string,
): { configDir: string; cleanup: () => void } {
  const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));

  let workspacePath: string;
  let relativeProjectPath: string;
  if (gitRootPath && existsSync(gitRootPath)) {
    workspacePath = dirname(gitRootPath);
    relativeProjectPath = basename(gitRootPath);
  } else {
    workspacePath = join(configDir, "workspace");
    mkdirSync(join(workspacePath, "test-project"), { recursive: true });
    relativeProjectPath = "test-project";
  }

  writeFileSync(
    join(configDir, "workspace.test.yaml"),
    [
      "name: test",
      ...(defaultModel !== null ? [`default_model: ${defaultModel}`] : []),
      `workspace_path: ${workspacePath}`,
      "projects:",
      "  - key: test-project",
      "    name: Test Project",
      `    project_path: ${relativeProjectPath}`,
      `    git_root_path: ${relativeProjectPath}`,
      "    default_branch: main",
      extraYaml,
    ].join("\n") + "\n",
  );

  // Write workflows into the workflows/ subdirectory so they take precedence
  // over the legacy workflows.yaml path (config loader checks workflows/ first).
  const workflowsDir = join(configDir, "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, "delivery.yaml"), DEFAULT_WORKFLOWS_YAML);
  extraWorkflows.forEach((yaml, idx) => {
    writeFileSync(join(workflowsDir, `extra-${idx}.yaml`), yaml);
  });

  // Dedicated bundled-source dir holding only the default `delivery` template.
  // Seeding from it is a no-op (delivery already exists in the workspace), and
  // it makes `delivery` the single bundled (non-deletable) workflow while any
  // extra workflows are treated as user-created.
  const bundledWorkflowsDir = join(configDir, "bundled-workflows");
  mkdirSync(bundledWorkflowsDir, { recursive: true });
  writeFileSync(join(bundledWorkflowsDir, "delivery.yaml"), DEFAULT_WORKFLOWS_YAML);

  extraWorkspaces.forEach(({ key, yaml }) => {
    writeFileSync(join(configDir, `workspace.${key}.yaml`), yaml);
  });

  const DEFAULT_ENGINES_YAML = "engines:\n  - id: copilot\n    type: copilot\n";
  writeFileSync(join(configDir, "engines.yaml"), enginesYaml ?? DEFAULT_ENGINES_YAML);

  process.env.RAILYN_DB = ":memory:";
  process.env.RAILYN_CONFIG_DIR = configDir;
  process.env.RAILYN_SESSION_MEMORY_DIR = join(configDir, "tasks");
  // Point workflow seeding at the dedicated bundled-source dir (delivery only),
  // so loadConfig() seeding is a no-op and `delivery` is the bundled workflow.
  process.env.RAILYN_BUNDLED_WORKFLOWS_DIR = bundledWorkflowsDir;
  resetConfig();
  loadConfig();

  return {
    configDir,
    cleanup: () => {
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_SESSION_MEMORY_DIR;
      delete process.env.RAILYN_DB;
      delete process.env.RAILYN_BUNDLED_WORKFLOWS_DIR;
      resetConfig();
    },
  };
}

// ─── Test registry factory ────────────────────────────────────────────────────

import { EngineRegistry } from "../engine/engine-registry.ts";
import type { ExecutionEngine } from "../engine/types.ts";
import { getWorkspaceConfig, getDefaultWorkspaceKey } from "../workspace-context.ts";

/**
 * Seed a standalone chat session with its own conversation.
 * Returns the session id and conversation id for use in executor tests.
 */
export function seedChatSession(
  db: Database,
  overrides: { workspaceKey?: string; title?: string; model?: string; lastEngineType?: string | null } = {},
): { sessionId: number; conversationId: number } {
  const workspaceKey = overrides.workspaceKey ?? "default";
  const title = overrides.title ?? "Test Session";

  db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
  const conversationId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  if (overrides.model) {
    db.run("UPDATE conversations SET model = ? WHERE id = ?", [overrides.model, conversationId]);
  }

  if (overrides.lastEngineType !== undefined) {
    db.run("UPDATE conversations SET last_engine_type = ? WHERE id = ?", [overrides.lastEngineType, conversationId]);
  }

  db.run(
    "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES (?, ?, 'idle', ?)",
    [workspaceKey, title, conversationId],
  );
  const sessionId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;

  return { sessionId, conversationId };
}

/**
 * Build an `EngineRegistry` containing a single engine for unit tests.
 * Must be called AFTER `setupTestConfig()` so the workspace config is loaded.
 * The engine is registered under the first engine ID declared in the loaded config
 * (backward-compat: `engine.type` from workspace.yaml, typically "copilot").
 */
export function makeTestRegistry(engine: ExecutionEngine): EngineRegistry {
  const config = getWorkspaceConfig(getDefaultWorkspaceKey());
  const engineId = config.engines[0]?.id ?? "copilot";
  return new EngineRegistry(new Map([[engineId, engine]]), getWorkspaceConfig);
}

/**
 * Build an `EngineRegistry` from an explicit Map of engine ID → engine instance.
 * Useful for multi-engine test scenarios where the default single-engine factory
 * is insufficient (e.g., testing engine-switch context injection).
 */
export function makeTestRegistryWith(engines: Map<string, ExecutionEngine>): EngineRegistry {
  return new EngineRegistry(engines, getWorkspaceConfig);
}
