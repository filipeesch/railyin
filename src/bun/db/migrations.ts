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
  {
    id: "002_task_ux_improvements",
    sql: `
      ALTER TABLE tasks ADD COLUMN model TEXT;
    `,
  },
  {
    id: "003_logs",
    sql: `
      CREATE TABLE IF NOT EXISTS logs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        level        TEXT    NOT NULL DEFAULT 'info',
        task_id      INTEGER,
        execution_id INTEGER,
        message      TEXT    NOT NULL,
        data         TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_logs_task      ON logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_logs_execution ON logs(execution_id);
      CREATE INDEX IF NOT EXISTS idx_logs_level     ON logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_created   ON logs(created_at);
    `,
  },
  {
    id: "005_enabled_models",
    sql: `
      CREATE TABLE IF NOT EXISTS enabled_models (
        workspace_id        INTEGER NOT NULL,
        qualified_model_id  TEXT    NOT NULL,
        PRIMARY KEY (workspace_id, qualified_model_id)
      );
    `,
  },
  {
    id: "004_hunk_decisions",
    sql: `
      CREATE TABLE IF NOT EXISTS task_hunk_decisions (
        task_id        INTEGER NOT NULL REFERENCES tasks(id),
        hunk_hash      TEXT    NOT NULL,
        file_path      TEXT    NOT NULL,
        reviewer_type  TEXT    NOT NULL DEFAULT 'human',
        reviewer_id    TEXT    NOT NULL DEFAULT 'user',
        decision       TEXT    NOT NULL DEFAULT 'pending',
        comment        TEXT,
        original_start INTEGER NOT NULL DEFAULT 0,
        modified_start INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, hunk_hash, reviewer_id)
      );
      CREATE INDEX IF NOT EXISTS idx_hunk_decisions_task ON task_hunk_decisions(task_id);
    `,
  },
  {
    id: "006_pending_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS pending_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        content    TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pending_messages_task ON pending_messages(task_id);
    `,
  },
  {
    id: "007_line_comments",
    sql: `
      CREATE TABLE IF NOT EXISTS task_line_comments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_path     TEXT    NOT NULL,
        line_start    INTEGER NOT NULL,
        line_end      INTEGER NOT NULL,
        line_text     TEXT    NOT NULL DEFAULT '[]',
        context_lines TEXT    NOT NULL DEFAULT '[]',
        comment       TEXT    NOT NULL,
        reviewer_id   TEXT    NOT NULL DEFAULT 'user',
        reviewer_type TEXT    NOT NULL DEFAULT 'human',
        sent          INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_line_comments_task_file_sent ON task_line_comments(task_id, file_path, sent);
    `,
  },
  {
    id: "008_hunk_decisions_sent",
    sql: `
      ALTER TABLE task_hunk_decisions ADD COLUMN sent          INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE task_hunk_decisions ADD COLUMN original_end  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE task_hunk_decisions ADD COLUMN modified_end  INTEGER NOT NULL DEFAULT 0;
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

  // In test mode (in-memory DB) also seed a minimal project + board so the
  // app boots into BoardView instead of the first-time setup wizard.
  // Tests then create their own task rows via /setup-test-env.
  if (process.env.RAILYN_DB === ":memory:") {
    const hasProject = db.query<{ id: number }, []>("SELECT id FROM projects LIMIT 1").get();
    if (!hasProject) {
      db.run(
        "INSERT INTO projects (workspace_id, name, project_path, git_root_path, default_branch) VALUES (1, 'Test Project', '/tmp', '/tmp', 'main')",
      );
      console.log("[db] Seeded test project");
    }
    const hasBoard = db.query<{ id: number }, []>("SELECT id FROM boards LIMIT 1").get();
    if (!hasBoard) {
      const project = db.query<{ id: number }, []>("SELECT id FROM projects LIMIT 1").get()!;
      db.run(
        "INSERT INTO boards (workspace_id, name, workflow_template_id, project_ids) VALUES (1, 'Test Board', 'delivery', ?)",
        [JSON.stringify([project.id])],
      );
      console.log("[db] Seeded test board");
    }
  }
}
