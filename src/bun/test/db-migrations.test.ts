import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { _resetForTests as resetDbSingleton, getDb } from "../db/index.ts";
import { runMigrations } from "../db/migrations/runner.ts";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "railyn-db-migrations-"));
  dbPath = join(tempDir, "railyn.db");
  process.env.RAILYN_DB = dbPath;
  resetDbSingleton();
});

afterEach(() => {
  resetDbSingleton();
  delete process.env.RAILYN_DB;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("does not fail when config_key already exists but migration 015 is not recorded", async () => {
    const rawDb = new Database(dbPath, { create: true });
    rawDb.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_migrations (id) VALUES
        ('001_initial'),
        ('002_task_ux_improvements'),
        ('003_logs'),
        ('004_hunk_decisions'),
        ('005_enabled_models'),
        ('006_pending_messages'),
        ('007_shell_command_approval'),
        ('007_line_comments'),
        ('008_hunk_decisions_sent'),
        ('008_task_todos'),
        ('009_execution_cost'),
        ('010_drop_todo_context'),
        ('011_execution_input_tokens'),
        ('012_execution_output_tokens'),
        ('013_execution_cache_creation_tokens'),
        ('014_execution_cache_read_tokens'),
        ('016_execution_checkpoints'),
        ('016_task_position'),
        ('017_task_position_backfill'),
        ('018_git_base_sha'),
        ('018_stream_events'),
        ('019_add_parent_block_id'),
        ('020_line_comment_columns'),
        ('021_model_raw_messages'),
        ('022_drop_workspace_project_fks'),
        ('023_text_keys'),
        ('024_todo_v2'),
        ('025_todo_phase'),
        ('026_chat_sessions'),
        ('027_nullable_executions'),
        ('028_chat_session_mcp_tools'),
        ('029_conversation_stream_cleanup');
      CREATE TABLE workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        config_key TEXT
      );
      CREATE TABLE executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        conversation_id INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        input_tokens INTEGER
      );
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        board_id INTEGER,
        workflow_state TEXT
      );
      CREATE TABLE stream_events (
        id INTEGER PRIMARY KEY,
        task_id INTEGER,
        execution_id INTEGER,
        seq INTEGER,
        block_id TEXT,
        type TEXT,
        content TEXT,
        metadata TEXT,
        parent_block_id TEXT,
        subagent_id TEXT,
        conversation_id INTEGER NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_key TEXT,
        title TEXT,
        status TEXT,
        conversation_id INTEGER
      );
      INSERT INTO workspaces (id, name, config_key) VALUES (1, 'My Workspace', 'default');
    `);
    rawDb.close();

    await runMigrations();

    const db = getDb();
    const applied = db.query<{ id: string }, [string]>("SELECT id FROM schema_migrations WHERE id = ?").get("015_workspace_config_key");
    expect(applied?.id).toBe("015_workspace_config_key");
  });

  it("boards and tasks have no FK constraints after migration — arbitrary workspace/project keys are accepted", async () => {
    await runMigrations();

    const db = getDb();

    // Insert a board with an arbitrary workspace_key — no compat row required
    expect(() =>
      db.run(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES ('nonexistent-ws', 'FK-Free Board', 'delivery', '[]')",
      )
    ).not.toThrow();
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;

    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const convId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;

    // Insert a task with an arbitrary project_key — no compat row required
    expect(() =>
      db.run(
        "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state, conversation_id) VALUES (?, 'nonexistent-proj', 'FK-Free Task', 'backlog', 'idle', ?)",
        [boardId, convId],
      )
    ).not.toThrow();
  });

  it("workspaces and projects tables do not exist after migration", async () => {
    await runMigrations();

    const db = getDb();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workspaces', 'projects')")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual([]);
  });

  it("repairs stream event conversation ids via executions first, then tasks, and prunes unrecoverable rows", async () => {
    const rawDb = new Database(dbPath, { create: true });
    rawDb.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO schema_migrations (id) VALUES
        ('001_initial'),
        ('002_task_ux_improvements'),
        ('003_logs'),
        ('004_hunk_decisions'),
        ('005_enabled_models'),
        ('006_pending_messages'),
        ('007_shell_command_approval'),
        ('007_line_comments'),
        ('008_hunk_decisions_sent'),
        ('008_task_todos'),
        ('009_execution_cost'),
        ('010_drop_todo_context'),
        ('011_execution_input_tokens'),
        ('012_execution_output_tokens'),
        ('013_execution_cache_creation_tokens'),
        ('014_execution_cache_read_tokens'),
        ('015_workspace_config_key'),
        ('016_execution_checkpoints'),
        ('016_task_position'),
        ('017_task_position_backfill'),
        ('018_git_base_sha'),
        ('018_stream_events'),
        ('019_add_parent_block_id'),
        ('020_line_comment_columns'),
        ('021_model_raw_messages'),
        ('022_drop_workspace_project_fks'),
        ('023_text_keys'),
        ('024_todo_v2'),
        ('025_todo_phase'),
        ('026_chat_sessions'),
        ('027_nullable_executions'),
        ('028_chat_session_mcp_tools');
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER,
        board_id INTEGER,
        workflow_state TEXT
      );
      CREATE TABLE executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        conversation_id INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        input_tokens INTEGER
      );
      CREATE TABLE stream_events (
        id INTEGER PRIMARY KEY,
        task_id INTEGER NOT NULL,
        execution_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        block_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT,
        parent_block_id TEXT,
        subagent_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (task_id, seq)
      );
      INSERT INTO conversations (id, task_id) VALUES (101, 1), (102, 2);
      INSERT INTO tasks (id, conversation_id) VALUES (1, 101), (2, NULL), (3, NULL);
      INSERT INTO executions (id, task_id, conversation_id) VALUES
        (11, 1, 101),
        (12, 2, NULL),
        (13, 3, NULL);
      INSERT INTO stream_events (id, task_id, execution_id, seq, block_id, type, content) VALUES
        (201, 1, 11, 0, 'exec-first', 'assistant', 'alpha'),
        (202, 2, 12, 0, 'task-fallback', 'assistant', 'beta'),
        (203, 3, 13, 0, 'unrecoverable', 'assistant', 'gamma');
    `);
    rawDb.close();

    await runMigrations();

    const db = getDb();
    const taskRow = db.query<{ conversation_id: number | null }, [number]>(
      "SELECT conversation_id FROM tasks WHERE id = ?",
    ).get(2);
    expect(taskRow?.conversation_id).toBe(102);

    const executionRow = db.query<{ conversation_id: number | null }, [number]>(
      "SELECT conversation_id FROM executions WHERE id = ?",
    ).get(12);
    expect(executionRow?.conversation_id).toBe(102);

    const streamRows = db.query<{ id: number; conversation_id: number | null }, []>(
      "SELECT id, conversation_id FROM stream_events ORDER BY id ASC",
    ).all();
    expect(streamRows).toEqual([
      { id: 201, conversation_id: 101 },
      { id: 202, conversation_id: 102 },
    ]);

    const taskIdColumn = db
      .query<{ name: string; notnull: number }, []>("PRAGMA table_info(stream_events)")
      .all()
      .find((column) => column.name === "task_id");
    expect(taskIdColumn).toBeUndefined();

    const conversationIdColumn = db
      .query<{ name: string; notnull: number }, []>("PRAGMA table_info(stream_events)")
      .all()
      .find((column) => column.name === "conversation_id");
    expect(conversationIdColumn?.notnull).toBe(1);
  });
});
