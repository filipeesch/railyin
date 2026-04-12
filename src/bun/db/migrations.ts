import { getDb } from "./index.ts";
import { getDefaultWorkspaceId } from "../workspace-context.ts";
import { listFileBackedProjects, listProjectsForWorkspace } from "../project-store.ts";
import { getWorkspaceIdForKey, getWorkspaceRegistry } from "../config/index.ts";
import type { Project } from "../../shared/rpc-types.ts";

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
    id: "007_shell_command_approval",
    sql: `
      ALTER TABLE tasks ADD COLUMN shell_auto_approve INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN approved_commands TEXT NOT NULL DEFAULT '[]';
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
  {
    id: "008_task_todos",
    sql: `
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
    `,
  },
  {
    id: "009_execution_cost",
    sql: `
      ALTER TABLE executions ADD COLUMN cost_estimate REAL;
    `,
  },
  {
    id: "010_drop_todo_context",
    sql: `
      ALTER TABLE task_todos DROP COLUMN context;
    `,
  },
  {
    id: "011_execution_input_tokens",
    sql: `ALTER TABLE executions ADD COLUMN input_tokens INTEGER;`,
  },
  {
    id: "012_execution_output_tokens",
    sql: `ALTER TABLE executions ADD COLUMN output_tokens INTEGER;`,
  },
  {
    id: "013_execution_cache_creation_tokens",
    sql: `ALTER TABLE executions ADD COLUMN cache_creation_input_tokens INTEGER;`,
  },
  {
    id: "014_execution_cache_read_tokens",
    sql: `ALTER TABLE executions ADD COLUMN cache_read_input_tokens INTEGER;`,
  },
  {
    id: "016_execution_checkpoints",
    sql: `
      CREATE TABLE IF NOT EXISTS task_execution_checkpoints (
        execution_id INTEGER PRIMARY KEY REFERENCES executions(id),
        stash_ref    TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    id: "015_workspace_config_key",
    sql: `
      ALTER TABLE workspaces ADD COLUMN config_key TEXT;
      UPDATE workspaces SET config_key = 'default' WHERE config_key IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_config_key ON workspaces(config_key);
    `,
  },
  {
    id: "016_task_position",
    sql: `
      ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0;
    `,
  },
  {
    id: "017_task_position_backfill",
    sql: `
      WITH ranked AS (
        SELECT id,
               (ROW_NUMBER() OVER (PARTITION BY board_id, workflow_state ORDER BY created_at)) * 1000.0 AS pos
        FROM tasks
      )
      UPDATE tasks SET position = (SELECT pos FROM ranked WHERE ranked.id = tasks.id);
    `,
  },
  {
    id: "018_stream_events",
    sql: `
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
    `,
  },
  {
    id: "019_add_parent_block_id",
    sql: `
      -- Add parent_block_id column if it doesn't already exist
      -- (for fresh DB, it will be in 018; for existing DB, this migration adds it)
    `,
  },
];

function hasColumn(tableName: string, columnName: string): boolean {
  const db = getDb();
  const columns = db.query<Record<string, unknown>, []>(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => String(column.name ?? "") === columnName);
}

function applyMigration(id: string, sql: string): void {
  const db = getDb();
  db.transaction(() => {
    if (id === "002_task_ux_improvements") {
      if (!hasColumn("tasks", "model")) {
        db.exec("ALTER TABLE tasks ADD COLUMN model TEXT");
      }
    } else if (id === "007_shell_command_approval") {
      if (!hasColumn("tasks", "shell_auto_approve")) {
        db.exec("ALTER TABLE tasks ADD COLUMN shell_auto_approve INTEGER NOT NULL DEFAULT 0");
      }
      if (!hasColumn("tasks", "approved_commands")) {
        db.exec("ALTER TABLE tasks ADD COLUMN approved_commands TEXT NOT NULL DEFAULT '[]'");
      }
    } else if (id === "015_workspace_config_key") {
      if (!hasColumn("workspaces", "config_key")) {
        db.exec("ALTER TABLE workspaces ADD COLUMN config_key TEXT");
      }
      db.run("UPDATE workspaces SET config_key = 'default' WHERE config_key IS NULL");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_config_key ON workspaces(config_key)");
    } else if (id === "016_task_position") {
      if (!hasColumn("tasks", "position")) {
        db.exec(sql);
      }
    } else if (id === "019_add_parent_block_id") {
      if (!hasColumn("stream_events", "parent_block_id")) {
        db.exec("ALTER TABLE stream_events ADD COLUMN parent_block_id TEXT");
      }
    } else {
      db.exec(sql);
    }
    db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
  })();
}

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

  // Sort migrations by ID to ensure they're applied in the correct order
  const sortedMigrations = [...migrations].sort((a, b) => a.id.localeCompare(b.id));

  for (const migration of sortedMigrations) {
    if (applied.has(migration.id)) continue;

    applyMigration(migration.id, migration.sql);

    console.log(`[db] Applied migration: ${migration.id}`);
  }
}

// ─── Seed default workspace ───────────────────────────────────────────────────

export function seedDefaultWorkspace(): void {
  const db = getDb();

  // In test mode (in-memory DB) also seed a minimal project + board so the
  // app boots into BoardView instead of the first-time setup wizard.
  // Tests then create their own task rows via /setup-test-env.
  if (process.env.RAILYN_DB === ":memory:") {
    const workspaceId = getDefaultWorkspaceId();
    const workspaceEntry = getWorkspaceRegistry()[0];

    db.run(
      "INSERT OR IGNORE INTO workspaces (id, name, config_key) VALUES (?, ?, ?)",
      [workspaceId, workspaceEntry?.name ?? "My Workspace", workspaceEntry?.key ?? "default"],
    );

    let projectId = db
      .query<{ id: number }, [number]>("SELECT id FROM projects WHERE workspace_id = ? LIMIT 1")
      .get(workspaceId)?.id;

    if (!projectId) {
      const projectPath = workspaceEntry?.configDir ?? process.cwd();
      db.run(
        `INSERT INTO projects
           (workspace_id, name, project_path, git_root_path, default_branch, slug, description)
         VALUES (?, 'UI Test Project', ?, ?, 'main', 'ui-test-project', 'Seeded for in-memory UI tests')`,
        [workspaceId, projectPath, projectPath],
      );
      projectId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()?.id;
      console.log("[db] Seeded test project");
    }

    const hasBoard = db.query<{ id: number }, []>("SELECT id FROM boards LIMIT 1").get();
    if (!hasBoard) {
      const projectIds = listProjectsForWorkspace(workspaceId).map((project) => project.id);
      const serializedProjectIds = JSON.stringify(projectIds.length > 0 ? projectIds : [projectId]);
      db.run(
        "INSERT INTO boards (workspace_id, name, workflow_template_id, project_ids) VALUES (?, 'Test Board', 'delivery', ?)",
        [workspaceId, serializedProjectIds],
      );
      console.log("[db] Seeded test board");
    }
  }
}

export function syncConfiguredWorkspaces(
  workspaces: Array<{ key: string; name: string }>,
): void {
  const db = getDb();
  db.transaction(() => {
    for (const workspace of workspaces) {
      const expectedId = getWorkspaceIdForKey(workspace.key);
      const byKey = db
        .query<{ id: number }, [string]>("SELECT id FROM workspaces WHERE config_key = ?")
        .get(workspace.key);

      if (!byKey) {
        db.run(
          "INSERT INTO workspaces (id, name, config_key) VALUES (?, ?, ?)",
          [expectedId, workspace.name, workspace.key],
        );
        continue;
      }

      if (byKey.id !== expectedId) {
        db.run("UPDATE boards SET workspace_id = ? WHERE workspace_id = ?", [expectedId, byKey.id]);
        db.run("UPDATE projects SET workspace_id = ? WHERE workspace_id = ?", [expectedId, byKey.id]);
        db.run("UPDATE enabled_models SET workspace_id = ? WHERE workspace_id = ?", [expectedId, byKey.id]);
        db.run(
          "UPDATE workspaces SET id = ?, name = ?, config_key = ? WHERE id = ?",
          [expectedId, workspace.name, workspace.key, byKey.id],
        );
        continue;
      }

      db.run(
        "UPDATE workspaces SET name = ?, config_key = ? WHERE id = ?",
        [workspace.name, workspace.key, expectedId],
      );
    }
  })();
}

export function syncConfiguredProjects(projects: Project[]): void {
  const db = getDb();
  db.transaction(() => {
    for (const project of projects) {
      db.run(
        `INSERT INTO projects
           (id, workspace_id, name, project_path, git_root_path, default_branch, slug, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           name = excluded.name,
           project_path = excluded.project_path,
           git_root_path = excluded.git_root_path,
           default_branch = excluded.default_branch,
           slug = excluded.slug,
           description = excluded.description`,
        [
          project.id,
          project.workspaceId,
          project.name,
          project.projectPath,
          project.gitRootPath,
          project.defaultBranch,
          project.slug ?? null,
          project.description ?? null,
        ],
      );
    }
  })();
}

export function syncFileBackedCompatibilityState(): void {
  syncConfiguredWorkspaces(
    getWorkspaceRegistry().map((workspace) => ({ key: workspace.key, name: workspace.name })),
  );
  syncConfiguredProjects(listFileBackedProjects());
}
