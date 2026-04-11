import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { _resetForTests as resetDbSingleton, getDb } from "../db/index.ts";
import { runMigrations, syncConfiguredProjects, syncConfiguredWorkspaces } from "../db/migrations.ts";
import { getProjectIdForKey, getWorkspaceIdForKey } from "../config/index.ts";

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
    const row = db.query<{ config_key: string | null }, [number]>("SELECT config_key FROM workspaces WHERE id = ?").get(1);
    expect(row?.config_key).toBe("default");
  });

  it("syncs file-backed workspaces into the compatibility workspaces table with stable ids", () => {
    runMigrations();

    syncConfiguredWorkspaces([
      { key: "default", name: "My Workspace" },
      { key: "work", name: "Work" },
    ]);

    const db = getDb();
    const rows = db
      .query<{ id: number; name: string; config_key: string }, []>(
        "SELECT id, name, config_key FROM workspaces ORDER BY config_key",
      )
      .all();

    expect(rows).toEqual([
      { id: 1, name: "My Workspace", config_key: "default" },
      { id: getWorkspaceIdForKey("work"), name: "Work", config_key: "work" },
    ]);
  });

  it("syncs file-backed projects into the compatibility projects table so FK-dependent writes succeed", () => {
    runMigrations();

    const workWorkspaceId = getWorkspaceIdForKey("work");
    const workProjectId = getProjectIdForKey("work", "backend");

    syncConfiguredWorkspaces([
      { key: "default", name: "My Workspace" },
      { key: "work", name: "Work" },
    ]);
    syncConfiguredProjects([
      {
        id: workProjectId,
        key: "backend",
        workspaceId: workWorkspaceId,
        workspaceKey: "work",
        name: "Backend",
        projectPath: "/tmp/backend",
        gitRootPath: "/tmp/backend",
        defaultBranch: "main",
      },
    ]);

    const db = getDb();
    expect(() =>
      db.run(
        "INSERT INTO boards (workspace_id, name, workflow_template_id, project_ids) VALUES (?, 'Work Board', 'delivery', '[]')",
        [workWorkspaceId],
      )
    ).not.toThrow();
    const boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
    db.run("INSERT INTO conversations (task_id) VALUES (0)");
    const conversationId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
    expect(() =>
      db.run(
        "INSERT INTO tasks (board_id, project_id, title, workflow_state, execution_state, conversation_id) VALUES (?, ?, 'Compat Task', 'backlog', 'idle', ?)",
        [boardId, workProjectId, conversationId],
      )
    ).not.toThrow();
  });
});
