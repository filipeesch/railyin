import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { _resetForTests as resetDbSingleton, getDb } from "../db/index.ts";
import { runMigrations } from "../db/migrations.ts";

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
  it("does not fail when config_key already exists but migration 015 is not recorded", () => {
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
        ('014_execution_cache_read_tokens');
      CREATE TABLE workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        config_key TEXT
      );
      INSERT INTO workspaces (id, name, config_key) VALUES (1, 'My Workspace', 'default');
    `);
    rawDb.close();

    expect(() => runMigrations()).not.toThrow();

    const db = getDb();
    const applied = db.query<{ id: string }, [string]>("SELECT id FROM schema_migrations WHERE id = ?").get("015_workspace_config_key");
    expect(applied?.id).toBe("015_workspace_config_key");
  });

  it("boards and tasks have no FK constraints after migration — arbitrary workspace/project keys are accepted", () => {
    runMigrations();

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

  it("workspaces and projects tables do not exist after migration", () => {
    runMigrations();

    const db = getDb();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('workspaces', 'projects')")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual([]);
  });
});
