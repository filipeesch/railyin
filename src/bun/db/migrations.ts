import { getDb } from "./index.ts";

// ─── Schema migrations ───────────────────────────────────────────────────────
// Each entry is applied in order. Once applied, it is recorded in the
// schema_migrations table and never run again.

const migrations: Array<{ id: string; sql: string }> = [
  {
    id: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id    INTEGER NOT NULL REFERENCES workspaces(id),
        name            TEXT    NOT NULL,
        project_path    TEXT    NOT NULL,
        git_root_path   TEXT    NOT NULL,
        default_branch  TEXT    NOT NULL DEFAULT 'main',
        slug            TEXT,
        description     TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS boards (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id         INTEGER NOT NULL REFERENCES workspaces(id),
        name                 TEXT    NOT NULL,
        workflow_template_id TEXT    NOT NULL,
        project_ids          TEXT    NOT NULL DEFAULT '[]',
        created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id                  INTEGER NOT NULL REFERENCES boards(id),
        project_id                INTEGER NOT NULL REFERENCES projects(id),
        title                     TEXT    NOT NULL,
        description               TEXT    NOT NULL DEFAULT '',
        workflow_state            TEXT    NOT NULL DEFAULT 'backlog',
        execution_state           TEXT    NOT NULL DEFAULT 'idle',
        conversation_id           INTEGER REFERENCES conversations(id),
        current_execution_id      INTEGER,
        retry_count               INTEGER NOT NULL DEFAULT 0,
        created_from_task_id      INTEGER REFERENCES tasks(id),
        created_from_execution_id INTEGER,
        created_at                TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS task_git_context (
        task_id         INTEGER PRIMARY KEY REFERENCES tasks(id),
        git_root_path   TEXT    NOT NULL,
        subrepo_path    TEXT,
        branch_name     TEXT,
        worktree_path   TEXT,
        worktree_status TEXT    NOT NULL DEFAULT 'not_created'
      );

      CREATE TABLE IF NOT EXISTS executions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     INTEGER NOT NULL REFERENCES tasks(id),
        from_state  TEXT    NOT NULL,
        to_state    TEXT    NOT NULL,
        prompt_id   TEXT,
        status      TEXT    NOT NULL DEFAULT 'running',
        attempt     INTEGER NOT NULL DEFAULT 1,
        started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        summary     TEXT,
        details     TEXT
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id         INTEGER NOT NULL REFERENCES tasks(id),
        conversation_id INTEGER NOT NULL REFERENCES conversations(id),
        type            TEXT    NOT NULL,
        role            TEXT,
        content         TEXT    NOT NULL DEFAULT '',
        metadata        TEXT,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_board       ON tasks(board_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project     ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_task     ON conversation_messages(task_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conv     ON conversation_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_executions_task   ON executions(task_id);
    `,
  },
];

export function runMigrations(): void {
  const db = getDb();

  // Ensure migrations table exists (bootstrap)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.query<{ id: string }, []>("SELECT id FROM schema_migrations").all().map((r) => r.id),
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    db.transaction(() => {
      db.exec(migration.sql);
      db.run("INSERT INTO schema_migrations (id) VALUES (?)", [migration.id]);
    })();

    console.log(`[db] Applied migration: ${migration.id}`);
  }
}

// ─── Seed default workspace ───────────────────────────────────────────────────

export function seedDefaultWorkspace(): void {
  const db = getDb();
  const existing = db.query<{ id: number }, []>("SELECT id FROM workspaces LIMIT 1").get();
  if (!existing) {
    db.run("INSERT INTO workspaces (id, name) VALUES (1, 'My Workspace')");
    console.log("[db] Seeded default workspace");
  }
}
