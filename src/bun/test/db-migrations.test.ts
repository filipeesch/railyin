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
      CREATE TABLE boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_key TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        workflow_template_id TEXT NOT NULL,
        project_keys TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE enabled_models (
        workspace_key TEXT NOT NULL,
        qualified_model_id TEXT NOT NULL,
        PRIMARY KEY (workspace_key, qualified_model_id)
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
        "INSERT INTO tasks (board_id, project_key, title, workflow_state, execution_state, conversation_id, created_at) VALUES (?, 'nonexistent-proj', 'FK-Free Task', 'backlog', 'idle', ?, datetime('now'))",
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

  // The "repairs stream event conversation ids" test (covering migration 029's
  // stream_events.conversation_id backfill) has been removed: migration 054 drops the
  // stream_events table entirely, so it no longer exists after a full runMigrations()
  // pass and this repair path can no longer be observed/asserted on.

  it("previousChecksums: does not throw when a migration file was amended after being applied", async () => {
    // Simulate a DB where migration 037 was applied with the OLD (buggy) checksum.
    // The runner should accept it via previousChecksums and update the stored checksum.
    await runMigrations();
    const db = getDb();

    // Overwrite the stored checksum for 037 with a value listed in its previousChecksums.
    const oldChecksum = "ff09dd18e2e49e937ae505b9cc04d00f2b9977c61e254f80934d986292e3a1f0";
    db.run("UPDATE schema_migrations SET checksum = ? WHERE id = ?", [oldChecksum, "037_remove_model_from_tasks"]);

    // runMigrations should not throw — it recognises the old checksum and updates it.
    await expect(runMigrations()).resolves.toBeUndefined();

    // Stored checksum should now be the current file checksum (not the old one).
    const row = db.query<{ checksum: string }, [string]>(
      "SELECT checksum FROM schema_migrations WHERE id = ?",
    ).get("037_remove_model_from_tasks");
    expect(row?.checksum).not.toBe(oldChecksum);
  });

  it("migration 044: converts NULL enabled_mcp_tools to '[]' in tasks and chat_sessions", async () => {
    const rawDb = new Database(dbPath, { create: true });
    // Mark all prior migrations as already applied so the runner only runs 044.
    // We provide minimal table schemas that satisfy any migrations the runner might
    // still attempt to apply (none — all are pre-marked as applied).
    rawDb.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), checksum TEXT);
      INSERT INTO schema_migrations (id) VALUES
        ('001_initial'),('002_task_ux_improvements'),('003_logs'),('004_hunk_decisions'),
        ('005_enabled_models'),('006_pending_messages'),('007_shell_command_approval'),
        ('007_line_comments'),('008_hunk_decisions_sent'),('008_task_todos'),
        ('009_execution_cost'),('010_drop_todo_context'),('011_execution_input_tokens'),
        ('012_execution_output_tokens'),('013_execution_cache_creation_tokens'),
        ('014_execution_cache_read_tokens'),('015_workspace_config_key'),
        ('016_execution_checkpoints'),('016_task_position'),('017_task_position_backfill'),
        ('018_git_base_sha'),('018_stream_events'),('019_add_parent_block_id'),
        ('020_line_comment_columns'),('021_model_raw_messages'),
        ('022_drop_workspace_project_fks'),('023_text_keys'),('024_todo_v2'),
        ('025_todo_phase'),('026_chat_sessions'),('027_nullable_executions'),
        ('028_chat_session_mcp_tools'),('029_conversation_stream_cleanup'),
        ('030_stream_events_cleanup'),('031_conversation_pagination_index'),
        ('032_perf_indices'),('033_stream_events_exec_index'),
        ('034_needs_column_prompt'),('035_add_model_to_conversations'),
        ('036_migrate_model_to_conversations'),('037_remove_model_from_tasks'),
        ('038_seed_copilot_auto_model'),('039_restore_tasks_created_at_default'),
        ('040_decision_records'),('041_last_engine_type'),
        ('042_decisions_injection_tracking'),('043_model_settings');

      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enabled_mcp_tools TEXT
      );
      CREATE TABLE chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enabled_mcp_tools TEXT
      );
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        model TEXT
      );
    `);

    rawDb.run("INSERT INTO tasks (enabled_mcp_tools) VALUES (NULL)");
    rawDb.run("INSERT INTO tasks (enabled_mcp_tools) VALUES (?)", ['["server:tool"]']);
    rawDb.run("INSERT INTO chat_sessions (enabled_mcp_tools) VALUES (NULL)");
    rawDb.run("INSERT INTO chat_sessions (enabled_mcp_tools) VALUES (?)", ['[]']);
    rawDb.close();

    await runMigrations();

    const db = getDb();
    const taskRows = db.query<{ enabled_mcp_tools: string | null }, []>(
      "SELECT enabled_mcp_tools FROM tasks ORDER BY id",
    ).all();
    expect(taskRows[0].enabled_mcp_tools).toBe("[]");
    expect(taskRows[1].enabled_mcp_tools).toBe('["server:tool"]');

    const sessionRows = db.query<{ enabled_mcp_tools: string | null }, []>(
      "SELECT enabled_mcp_tools FROM chat_sessions ORDER BY id",
    ).all();
    expect(sessionRows[0].enabled_mcp_tools).toBe("[]");
    expect(sessionRows[1].enabled_mcp_tools).toBe("[]");
  });
});

describe("Migrations 053/054 — drop dead tables (model_raw_messages, stream_events)", () => {
  it("053_drop_model_raw_messages: drops the table without error even when existing rows are present", async () => {
    const rawDb = new Database(dbPath, { create: true });
    // Mark every migration through 052 as already applied, so the runner only runs 053+.
    rawDb.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), checksum TEXT);
      INSERT INTO schema_migrations (id) VALUES
        ('001_initial'),('002_task_ux_improvements'),('003_logs'),('004_hunk_decisions'),
        ('005_enabled_models'),('006_pending_messages'),('007_shell_command_approval'),
        ('007_line_comments'),('008_hunk_decisions_sent'),('008_task_todos'),
        ('009_execution_cost'),('010_drop_todo_context'),('011_execution_input_tokens'),
        ('012_execution_output_tokens'),('013_execution_cache_creation_tokens'),
        ('014_execution_cache_read_tokens'),('015_workspace_config_key'),
        ('016_execution_checkpoints'),('016_task_position'),('017_task_position_backfill'),
        ('018_git_base_sha'),('018_stream_events'),('019_add_parent_block_id'),
        ('020_line_comment_columns'),('021_model_raw_messages'),
        ('022_drop_workspace_project_fks'),('023_text_keys'),('024_todo_v2'),
        ('025_todo_phase'),('026_chat_sessions'),('027_nullable_executions'),
        ('028_chat_session_mcp_tools'),('029_conversation_stream_cleanup'),
        ('030_stream_events_cleanup'),('031_conversation_pagination_index'),
        ('032_perf_indices'),('033_stream_events_exec_index'),
        ('034_needs_column_prompt'),('035_add_model_to_conversations'),
        ('036_migrate_model_to_conversations'),('037_remove_model_from_tasks'),
        ('038_seed_copilot_auto_model'),('039_restore_tasks_created_at_default'),
        ('040_decision_records'),('041_last_engine_type'),
        ('042_decisions_injection_tracking'),('043_model_settings'),
        ('044_mcp_disabled_by_default'),('045_task_notes'),('046_drop_notes_title'),
        ('047_conversation_sampling_preset'),('048_chat_cascade'),
        ('049_chat_session_shell_approval'),('050_conversation_reasoning_mode'),
        ('051_conversation_model_params'),('052_conversation_storage_medium');

      CREATE TABLE model_raw_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        execution_id INTEGER,
        seq INTEGER,
        engine TEXT,
        event_type TEXT,
        payload TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO model_raw_messages (task_id, execution_id, seq, engine, event_type, payload) VALUES
        (1, 11, 0, 'claude', 'text', '{"raw":"data"}');
    `);
    rawDb.close();

    await expect(runMigrations()).resolves.toBeUndefined();

    const db = getDb();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name = 'model_raw_messages'")
      .all();
    expect(tables).toEqual([]);
  });

  it("054_drop_stream_events: drops the table without error even when existing rows are present", async () => {
    const rawDb = new Database(dbPath, { create: true });
    // Mark every migration through 053 as already applied, so the runner only runs 054+.
    rawDb.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')), checksum TEXT);
      INSERT INTO schema_migrations (id) VALUES
        ('001_initial'),('002_task_ux_improvements'),('003_logs'),('004_hunk_decisions'),
        ('005_enabled_models'),('006_pending_messages'),('007_shell_command_approval'),
        ('007_line_comments'),('008_hunk_decisions_sent'),('008_task_todos'),
        ('009_execution_cost'),('010_drop_todo_context'),('011_execution_input_tokens'),
        ('012_execution_output_tokens'),('013_execution_cache_creation_tokens'),
        ('014_execution_cache_read_tokens'),('015_workspace_config_key'),
        ('016_execution_checkpoints'),('016_task_position'),('017_task_position_backfill'),
        ('018_git_base_sha'),('018_stream_events'),('019_add_parent_block_id'),
        ('020_line_comment_columns'),('021_model_raw_messages'),
        ('022_drop_workspace_project_fks'),('023_text_keys'),('024_todo_v2'),
        ('025_todo_phase'),('026_chat_sessions'),('027_nullable_executions'),
        ('028_chat_session_mcp_tools'),('029_conversation_stream_cleanup'),
        ('030_stream_events_cleanup'),('031_conversation_pagination_index'),
        ('032_perf_indices'),('033_stream_events_exec_index'),
        ('034_needs_column_prompt'),('035_add_model_to_conversations'),
        ('036_migrate_model_to_conversations'),('037_remove_model_from_tasks'),
        ('038_seed_copilot_auto_model'),('039_restore_tasks_created_at_default'),
        ('040_decision_records'),('041_last_engine_type'),
        ('042_decisions_injection_tracking'),('043_model_settings'),
        ('044_mcp_disabled_by_default'),('045_task_notes'),('046_drop_notes_title'),
        ('047_conversation_sampling_preset'),('048_chat_cascade'),
        ('049_chat_session_shell_approval'),('050_conversation_reasoning_mode'),
        ('051_conversation_model_params'),('052_conversation_storage_medium'),
        ('053_drop_model_raw_messages');

      CREATE TABLE stream_events (
        id INTEGER PRIMARY KEY,
        task_id INTEGER NOT NULL,
        execution_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        block_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO stream_events (id, task_id, execution_id, seq, block_id, type, content) VALUES
        (1, 1, 11, 0, 'blk', 'assistant', 'hello');
    `);
    rawDb.close();

    await expect(runMigrations()).resolves.toBeUndefined();

    const db = getDb();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name = 'stream_events'")
      .all();
    expect(tables).toEqual([]);
  });
});

describe("Migration 048 — chat cascade", () => {
  it("M-048a: full migration stack completes without error", async () => {
    await expect(runMigrations()).resolves.toBeUndefined();
  });

  it("M-048b: deleting a conversation cascades to conversation_messages", async () => {
    await runMigrations();
    const db = getDb();

    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const { id: convId } = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;

    db.run(
      "INSERT INTO conversation_messages (conversation_id, type, content) VALUES (?, 'user', 'hi')",
      [convId],
    );
    const before = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM conversation_messages").get()!.n;
    expect(before).toBe(1);

    db.run("DELETE FROM conversations WHERE id = ?", [convId]);

    const after = db.query<{ n: number }, []>("SELECT COUNT(*) as n FROM conversation_messages").get()!.n;
    expect(after).toBe(0);
  });

  // M-048c ("deleting a conversation cascades to stream_events") removed: migration 054
  // drops the stream_events table entirely, so it no longer exists after a full
  // runMigrations() pass and this cascade can no longer be exercised.
});
