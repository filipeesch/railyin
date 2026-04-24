import { getDb } from "./index.ts";
import { createHash } from "node:crypto";
import { getWorkspaceRegistry, loadConfig, getConfig } from "../config/index.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

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
    id: "018_git_base_sha",
    sql: `ALTER TABLE task_git_context ADD COLUMN base_sha TEXT;`,
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
  {
    id: "020_line_comment_columns",
    sql: `
      ALTER TABLE task_line_comments ADD COLUMN col_start INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE task_line_comments ADD COLUMN col_end   INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: "021_model_raw_messages",
    sql: `
      CREATE TABLE IF NOT EXISTS model_raw_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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

      CREATE INDEX IF NOT EXISTS idx_model_raw_messages_execution_seq
        ON model_raw_messages (execution_id, stream_seq);
      CREATE INDEX IF NOT EXISTS idx_model_raw_messages_task_created
        ON model_raw_messages (task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_model_raw_messages_engine_type
        ON model_raw_messages (engine, event_type);
    `,
  },
  {
    id: "022_drop_workspace_project_fks",
    // Handled specially in applyMigration — requires PRAGMA foreign_keys = OFF outside transaction.
    sql: `
      CREATE TABLE IF NOT EXISTS boards_new (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id         INTEGER NOT NULL,
        name                 TEXT    NOT NULL,
        workflow_template_id TEXT    NOT NULL,
        project_ids          TEXT    NOT NULL DEFAULT '[]',
        created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO boards_new (id, workspace_id, name, workflow_template_id, project_ids, created_at)
        SELECT id, workspace_id, name, workflow_template_id, project_ids, created_at FROM boards;
      DROP TABLE IF EXISTS boards;
      ALTER TABLE boards_new RENAME TO boards;

      CREATE TABLE IF NOT EXISTS tasks_new (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id                  INTEGER NOT NULL REFERENCES boards(id),
        project_id                INTEGER NOT NULL,
        title                     TEXT    NOT NULL,
        description               TEXT    NOT NULL DEFAULT '',
        workflow_state            TEXT    NOT NULL DEFAULT 'backlog',
        execution_state           TEXT    NOT NULL DEFAULT 'idle',
        conversation_id           INTEGER REFERENCES conversations(id),
        current_execution_id      INTEGER,
        retry_count               INTEGER NOT NULL DEFAULT 0,
        created_from_task_id      INTEGER REFERENCES tasks(id),
        created_from_execution_id INTEGER,
        created_at                TEXT    NOT NULL DEFAULT (datetime('now')),
        model                     TEXT,
        shell_auto_approve        INTEGER NOT NULL DEFAULT 0,
        approved_commands         TEXT    NOT NULL DEFAULT '[]',
        position                  REAL    NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO tasks_new
        (id, board_id, project_id, title, description, workflow_state, execution_state,
         conversation_id, current_execution_id, retry_count, created_from_task_id,
         created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position)
        SELECT id, board_id, project_id, title, description, workflow_state, execution_state,
               conversation_id, current_execution_id, retry_count, created_from_task_id,
               created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position
        FROM tasks;
      DROP TABLE IF EXISTS tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      DROP TABLE IF EXISTS workspaces;
      DROP TABLE IF EXISTS projects;

      CREATE INDEX IF NOT EXISTS idx_tasks_board   ON tasks(board_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    `,
  },
  {
    id: "023_text_keys",
    sql: "", // handled programmatically in applyMigration
  },
  {
    id: "024_todo_v2",
    sql: "", // handled programmatically in applyMigration
  },
  {
    id: "025_todo_phase",
    sql: "", // handled programmatically in applyMigration
  },
  {
    id: "026_chat_sessions",
    sql: `-- handled in applyMigration special case`,
  },
  {
    id: "027_nullable_executions",
    sql: `-- handled in applyMigration special case`,
  },
  {
    id: "028_chat_session_mcp_tools",
    sql: `-- handled in applyMigration special case`,
  },
  {
    id: "029_conversation_stream_cleanup",
    sql: `-- handled in applyMigration special case`,
  },
];

function hasColumn(tableName: string, columnName: string): boolean {
  const db = getDb();
  const columns = db.query<Record<string, unknown>, []>(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => String(column.name ?? "") === columnName);
}

function hasTable(tableName: string): boolean {
  const db = getDb();
  const row = db
    .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName);
  return row !== null;
}

function applyMigration(id: string, sql: string): void {
  const db = getDb();

  if (id === "022_drop_workspace_project_fks") {
    // PRAGMA foreign_keys must be set outside a transaction per SQLite docs.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.transaction(() => {
        // Recreate boards without the workspace FK (one statement per exec for safety)
        db.exec(
          "CREATE TABLE IF NOT EXISTS boards_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  workspace_id INTEGER NOT NULL," +
          "  name TEXT NOT NULL," +
          "  workflow_template_id TEXT NOT NULL," +
          "  project_ids TEXT NOT NULL DEFAULT '[]'," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
          ")"
        );
        if (hasTable("boards")) {
          db.exec(
            "INSERT OR IGNORE INTO boards_new (id, workspace_id, name, workflow_template_id, project_ids, created_at)" +
            " SELECT id, workspace_id, name, workflow_template_id, project_ids, created_at FROM boards"
          );
          db.exec("DROP TABLE IF EXISTS boards");
        }
        db.exec("ALTER TABLE boards_new RENAME TO boards");

        // Recreate tasks without the project FK
        db.exec(
          "CREATE TABLE IF NOT EXISTS tasks_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  board_id INTEGER NOT NULL REFERENCES boards(id)," +
          "  project_id INTEGER NOT NULL," +
          "  title TEXT NOT NULL," +
          "  description TEXT NOT NULL DEFAULT ''," +
          "  workflow_state TEXT NOT NULL DEFAULT 'backlog'," +
          "  execution_state TEXT NOT NULL DEFAULT 'idle'," +
          "  conversation_id INTEGER REFERENCES conversations(id)," +
          "  current_execution_id INTEGER," +
          "  retry_count INTEGER NOT NULL DEFAULT 0," +
          "  created_from_task_id INTEGER," +
          "  created_from_execution_id INTEGER," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
          "  model TEXT," +
          "  shell_auto_approve INTEGER NOT NULL DEFAULT 0," +
          "  approved_commands TEXT NOT NULL DEFAULT '[]'," +
          "  position REAL NOT NULL DEFAULT 0" +
          ")"
        );
        if (hasTable("tasks")) {
          db.exec(
            "INSERT OR IGNORE INTO tasks_new" +
            " (id, board_id, project_id, title, description, workflow_state, execution_state," +
            "  conversation_id, current_execution_id, retry_count, created_from_task_id," +
            "  created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position)" +
            " SELECT id, board_id, project_id, title, description, workflow_state, execution_state," +
            "        conversation_id, current_execution_id, retry_count, created_from_task_id," +
            "        created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position" +
            " FROM tasks"
          );
          db.exec("DROP TABLE IF EXISTS tasks");
        }
        db.exec("ALTER TABLE tasks_new RENAME TO tasks");

        db.exec("DROP TABLE IF EXISTS workspaces");
        db.exec("DROP TABLE IF EXISTS projects");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
        db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
      })();
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    return;
  }

  if (id === "023_text_keys") {
    const _stableId = (seed: string): number => {
      const hex = createHash("sha1").update(seed).digest("hex").slice(0, 12);
      return parseInt(hex, 16);
    };
    const _wsNumericId = (key: string): number => key === "default" ? 1 : _stableId(`workspace:${key}`);
    const _projNumericId = (wsKey: string, projKey: string): number => _stableId(`project:${wsKey}:${projKey}`);

    const registry = getWorkspaceRegistry();
    const wsIdToKey = new Map<number, string>();
    for (const entry of registry) {
      wsIdToKey.set(_wsNumericId(entry.key), entry.key);
    }

    const projIdToKey = new Map<number, string>();
    for (const entry of registry) {
      try {
        const config = loadConfig(entry.key).config ?? getConfig(entry.key);
        for (const proj of config.projects) {
          projIdToKey.set(_projNumericId(entry.key, proj.key), proj.key);
        }
      } catch { /* ignore missing configs */ }
    }

    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.transaction(() => {
        // 1. Recreate boards with workspace_key TEXT
        db.exec(
          "CREATE TABLE IF NOT EXISTS boards_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  workspace_key TEXT NOT NULL DEFAULT 'default'," +
          "  name TEXT NOT NULL," +
          "  workflow_template_id TEXT NOT NULL," +
          "  project_keys TEXT NOT NULL DEFAULT '[]'," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
          ")"
        );
        if (hasTable("boards")) {
          const boardRows = db.query<{
            id: number; workspace_id: number; name: string;
            workflow_template_id: string; project_ids: string; created_at: string;
          }, []>("SELECT id, workspace_id, name, workflow_template_id, project_ids, created_at FROM boards").all();
          for (const row of boardRows) {
            const wsKey = wsIdToKey.get(row.workspace_id) ?? "default";
            let projectKeys: string[] = [];
            try {
              const numericIds: number[] = JSON.parse(row.project_ids);
              projectKeys = numericIds.map((pid) => projIdToKey.get(pid) ?? String(pid));
            } catch { /* leave empty */ }
            db.run(
              "INSERT OR IGNORE INTO boards_new (id, workspace_key, name, workflow_template_id, project_keys, created_at) VALUES (?, ?, ?, ?, ?, ?)",
              [row.id, wsKey, row.name, row.workflow_template_id, JSON.stringify(projectKeys), row.created_at]
            );
          }
          db.exec("DROP TABLE IF EXISTS boards");
        }
        db.exec("ALTER TABLE boards_new RENAME TO boards");

        // 2. Recreate tasks with project_key TEXT
        db.exec(
          "CREATE TABLE IF NOT EXISTS tasks_new (" +
          "  id INTEGER PRIMARY KEY AUTOINCREMENT," +
          "  board_id INTEGER NOT NULL REFERENCES boards(id)," +
          "  project_key TEXT NOT NULL DEFAULT 'unknown'," +
          "  title TEXT NOT NULL," +
          "  description TEXT NOT NULL DEFAULT ''," +
          "  workflow_state TEXT NOT NULL DEFAULT 'backlog'," +
          "  execution_state TEXT NOT NULL DEFAULT 'idle'," +
          "  conversation_id INTEGER REFERENCES conversations(id)," +
          "  current_execution_id INTEGER," +
          "  retry_count INTEGER NOT NULL DEFAULT 0," +
          "  created_from_task_id INTEGER," +
          "  created_from_execution_id INTEGER," +
          "  created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
          "  model TEXT," +
          "  shell_auto_approve INTEGER NOT NULL DEFAULT 0," +
          "  approved_commands TEXT NOT NULL DEFAULT '[]'," +
          "  position REAL NOT NULL DEFAULT 0" +
          ")"
        );
        if (hasTable("tasks")) {
          const taskRows = db.query<{
            id: number; board_id: number; project_id: number; title: string; description: string;
            workflow_state: string; execution_state: string; conversation_id: number | null;
            current_execution_id: number | null; retry_count: number;
            created_from_task_id: number | null; created_from_execution_id: number | null;
            created_at: string; model: string | null; shell_auto_approve: number;
            approved_commands: string; position: number;
          }, []>("SELECT id, board_id, project_id, title, description, workflow_state, execution_state, conversation_id, current_execution_id, retry_count, created_from_task_id, created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position FROM tasks").all();
          for (const row of taskRows) {
            const projectKey = projIdToKey.get(row.project_id) ?? "unknown";
            db.run(
              "INSERT OR IGNORE INTO tasks_new (id, board_id, project_key, title, description, workflow_state, execution_state, conversation_id, current_execution_id, retry_count, created_from_task_id, created_from_execution_id, created_at, model, shell_auto_approve, approved_commands, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [row.id, row.board_id, projectKey, row.title, row.description, row.workflow_state, row.execution_state, row.conversation_id, row.current_execution_id, row.retry_count, row.created_from_task_id, row.created_from_execution_id, row.created_at, row.model, row.shell_auto_approve, row.approved_commands, row.position]
            );
          }
          db.exec("DROP TABLE IF EXISTS tasks");
        }
        db.exec("ALTER TABLE tasks_new RENAME TO tasks");

        // 3. Recreate enabled_models with workspace_key TEXT
        db.exec(
          "CREATE TABLE IF NOT EXISTS enabled_models_new (" +
          "  workspace_key TEXT NOT NULL," +
          "  qualified_model_id TEXT NOT NULL," +
          "  PRIMARY KEY (workspace_key, qualified_model_id)" +
          ")"
        );
        if (hasTable("enabled_models")) {
          const modelRows = db.query<{ workspace_id: number; qualified_model_id: string }, []>(
            "SELECT workspace_id, qualified_model_id FROM enabled_models"
          ).all();
          for (const row of modelRows) {
            const wsKey = wsIdToKey.get(row.workspace_id) ?? "default";
            db.run(
              "INSERT OR IGNORE INTO enabled_models_new (workspace_key, qualified_model_id) VALUES (?, ?)",
              [wsKey, row.qualified_model_id]
            );
          }
          db.exec("DROP TABLE IF EXISTS enabled_models");
        }
        db.exec("ALTER TABLE enabled_models_new RENAME TO enabled_models");

        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id)");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_key)");
        db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
      })();
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    return;
  }

  if (id === "026_chat_sessions") {
    // PRAGMA foreign_keys must be set outside a transaction (tasks.conversation_id → conversations).
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      // Use BEGIN IMMEDIATE to acquire the write lock upfront.
      // In WAL mode, db.transaction() uses BEGIN DEFERRED, which acquires the lock lazily
      // on the first actual write. When all early guards are no-ops the first write can
      // be the backfill UPDATE deep in the migration, causing a late SQLITE_BUSY timeout.
      db.exec("BEGIN IMMEDIATE");
      try {
        // 1. Make conversations.task_id nullable and add fork columns.
        //    Only needed when task_id is currently NOT NULL (fresh DB from migration 001).
        //    Drop any leftover _new table from a previously interrupted run.
        db.exec("DROP TABLE IF EXISTS conversations_new");
        const convCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(conversations)").all();
        const taskIdNotNull = convCols.find(c => c.name === "task_id")?.notnull === 1;
        if (taskIdNotNull) {
          db.exec(
            "CREATE TABLE conversations_new (" +
            "  id                     INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  task_id                INTEGER NULL," +
            "  parent_conversation_id INTEGER NULL," +
            "  forked_at_message_id   INTEGER NULL" +
            ")"
          );
          db.exec("INSERT INTO conversations_new (id, task_id) SELECT id, task_id FROM conversations");
          db.exec("DROP TABLE conversations");
          db.exec("ALTER TABLE conversations_new RENAME TO conversations");
        } else if (hasTable("conversations") && !hasColumn("conversations", "parent_conversation_id")) {
          // task_id already nullable but fork columns missing — add them
          db.exec("ALTER TABLE conversations ADD COLUMN parent_conversation_id INTEGER NULL");
          db.exec("ALTER TABLE conversations ADD COLUMN forked_at_message_id INTEGER NULL");
        }

        // 2. Add conversation_id to stream_events (one statement per exec)
        if (hasTable("stream_events") && !hasColumn("stream_events", "conversation_id")) {
          // No REFERENCES clause here — SQLite validates FK targets in ADD COLUMN even with
          // foreign_keys=OFF, and conversations may not exist in partial-schema environments.
          db.exec("ALTER TABLE stream_events ADD COLUMN conversation_id INTEGER NULL");
        }

        // 3. Backfill stream_events.conversation_id from task_id join
        if (hasTable("stream_events") && hasColumn("stream_events", "conversation_id") && hasTable("conversations")) {
          db.exec(
            "UPDATE stream_events" +
            " SET conversation_id = (SELECT c.id FROM conversations c WHERE c.task_id = stream_events.task_id)" +
            " WHERE task_id IS NOT NULL AND conversation_id IS NULL"
          );
        }

        // 4. Make conversation_messages.task_id nullable if currently NOT NULL
        db.exec("DROP TABLE IF EXISTS conversation_messages_new");
        const msgCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(conversation_messages)").all();
        const msgTaskIdNotNull = msgCols.find(c => c.name === "task_id")?.notnull === 1;
        if (msgTaskIdNotNull) {
          db.exec(
            "CREATE TABLE conversation_messages_new (" +
            "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  task_id         INTEGER NULL," +
            "  conversation_id INTEGER NOT NULL REFERENCES conversations(id)," +
            "  type            TEXT NOT NULL," +
            "  role            TEXT," +
            "  content         TEXT NOT NULL," +
            "  metadata        TEXT," +
            "  created_at      TEXT NOT NULL DEFAULT (datetime('now'))" +
            ")"
          );
          db.exec(
            "INSERT INTO conversation_messages_new" +
            " (id, task_id, conversation_id, type, role, content, metadata, created_at)" +
            " SELECT id, task_id, conversation_id, type, role, content, metadata, created_at" +
            " FROM conversation_messages"
          );
          db.exec("DROP TABLE conversation_messages");
          db.exec("ALTER TABLE conversation_messages_new RENAME TO conversation_messages");
        }

        // 5. Create chat_sessions table
        if (hasTable("conversations")) {
          db.exec(
            "CREATE TABLE IF NOT EXISTS chat_sessions (" +
            "  id               INTEGER PRIMARY KEY AUTOINCREMENT," +
            "  workspace_key    TEXT    NOT NULL," +
            "  title            TEXT    NOT NULL," +
            "  status           TEXT    NOT NULL DEFAULT 'idle'," +
            "  conversation_id  INTEGER NOT NULL UNIQUE REFERENCES conversations(id)," +
            "  last_activity_at TEXT    NOT NULL DEFAULT (datetime('now'))," +
            "  last_read_at     TEXT    NULL," +
            "  archived_at      TEXT    NULL," +
            "  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))" +
            ")"
          );
          db.exec("CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_activity ON chat_sessions(workspace_key, last_activity_at DESC)");
        }

        // 6. Index on stream_events(conversation_id)
        if (hasTable("stream_events") && hasColumn("stream_events", "conversation_id")) {
          db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events(conversation_id, seq)");
        }

        db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    return;
  }

  if (id === "027_nullable_executions") {
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        // 1. Make executions.task_id nullable and add conversation_id column
        if (hasTable("executions")) {
          db.exec("DROP TABLE IF EXISTS executions_new");
          const execCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(executions)").all();
          const execTaskIdNotNull = execCols.find(c => c.name === "task_id")?.notnull === 1;
          if (execTaskIdNotNull || !execCols.some(c => c.name === "conversation_id")) {
            db.exec(
              "CREATE TABLE executions_new (" +
              "  id                           INTEGER PRIMARY KEY AUTOINCREMENT," +
              "  task_id                      INTEGER NULL," +
              "  conversation_id              INTEGER NULL," +
              "  from_state                   TEXT    NOT NULL DEFAULT ''," +
              "  to_state                     TEXT    NOT NULL DEFAULT ''," +
              "  prompt_id                    TEXT," +
              "  status                       TEXT    NOT NULL DEFAULT 'running'," +
              "  attempt                      INTEGER NOT NULL DEFAULT 1," +
              "  started_at                   TEXT    NOT NULL DEFAULT (datetime('now'))," +
              "  finished_at                  TEXT," +
              "  summary                      TEXT," +
              "  details                      TEXT," +
              "  cost_estimate                REAL," +
              "  input_tokens                 INTEGER," +
              "  output_tokens                INTEGER," +
              "  cache_creation_input_tokens  INTEGER," +
              "  cache_read_input_tokens      INTEGER" +
              ")"
            );
            db.exec(
              "INSERT INTO executions_new (id, task_id, from_state, to_state, prompt_id, status, attempt, started_at, finished_at, summary, details, cost_estimate, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)" +
              " SELECT id, task_id, from_state, to_state, prompt_id, status, attempt, started_at, finished_at, summary, details, cost_estimate, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens FROM executions"
            );
            db.exec(
              "UPDATE executions_new SET conversation_id = (" +
              "  SELECT t.conversation_id FROM tasks t WHERE t.id = executions_new.task_id" +
              ") WHERE task_id IS NOT NULL"
            );
            db.exec("DROP TABLE executions");
            db.exec("ALTER TABLE executions_new RENAME TO executions");
            db.exec("CREATE INDEX IF NOT EXISTS idx_executions_task ON executions(task_id)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_executions_conversation ON executions(conversation_id)");
          }
        }

        // 2. Make model_raw_messages.task_id nullable
        if (hasTable("model_raw_messages")) {
          db.exec("DROP TABLE IF EXISTS model_raw_messages_new");
          const rawCols = db.query<{ name: string; notnull: number }, []>("PRAGMA table_info(model_raw_messages)").all();
          const rawTaskIdNotNull = rawCols.find(c => c.name === "task_id")?.notnull === 1;
          if (rawTaskIdNotNull) {
            db.exec(
              "CREATE TABLE model_raw_messages_new (" +
              "  id              INTEGER PRIMARY KEY AUTOINCREMENT," +
              "  task_id         INTEGER NULL," +
              "  execution_id    INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE," +
              "  engine          TEXT    NOT NULL," +
              "  session_id      TEXT," +
              "  stream_seq      INTEGER NOT NULL," +
              "  direction       TEXT    NOT NULL," +
              "  event_type      TEXT    NOT NULL," +
              "  event_subtype   TEXT," +
              "  payload_json    TEXT    NOT NULL," +
              "  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))" +
              ")"
            );
            db.exec(
              "INSERT INTO model_raw_messages_new" +
              " (id, task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at)" +
              " SELECT id, task_id, execution_id, engine, session_id, stream_seq, direction, event_type, event_subtype, payload_json, created_at" +
              " FROM model_raw_messages"
            );
            db.exec("DROP TABLE model_raw_messages");
            db.exec("ALTER TABLE model_raw_messages_new RENAME TO model_raw_messages");
            db.exec("CREATE INDEX IF NOT EXISTS idx_model_raw_messages_execution_seq ON model_raw_messages (execution_id, stream_seq)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_model_raw_messages_task_created ON model_raw_messages (task_id, created_at)");
            db.exec("CREATE INDEX IF NOT EXISTS idx_model_raw_messages_engine_type ON model_raw_messages (engine, event_type)");
          }
        }

        db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    return;
  }

  if (id === "029_conversation_stream_cleanup") {
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (hasTable("tasks") && hasColumn("tasks", "conversation_id") && hasTable("conversations")) {
          db.exec(
            "UPDATE tasks" +
            " SET conversation_id = (" +
            "  SELECT c.id FROM conversations c WHERE c.task_id = tasks.id ORDER BY c.id ASC LIMIT 1" +
            " )" +
            " WHERE conversation_id IS NULL"
          );
        }

        if (hasTable("executions") && hasColumn("executions", "conversation_id") && hasTable("tasks")) {
          db.exec(
            "UPDATE executions" +
            " SET conversation_id = (" +
            "  SELECT t.conversation_id FROM tasks t WHERE t.id = executions.task_id" +
            " )" +
            " WHERE task_id IS NOT NULL AND conversation_id IS NULL"
          );
        }

        if (hasTable("stream_events")) {
          if (!hasColumn("stream_events", "conversation_id")) {
            db.exec("ALTER TABLE stream_events ADD COLUMN conversation_id INTEGER NULL");
          }

          db.exec(
            "UPDATE stream_events" +
            " SET conversation_id = (" +
            "  SELECT e.conversation_id FROM executions e WHERE e.id = stream_events.execution_id" +
            " )" +
            " WHERE conversation_id IS NULL"
          );

          if (hasTable("tasks")) {
            db.exec(
              "UPDATE stream_events" +
              " SET conversation_id = (" +
              "  SELECT t.conversation_id FROM tasks t WHERE t.id = stream_events.task_id" +
              " )" +
              " WHERE conversation_id IS NULL AND task_id IS NOT NULL"
            );
          }

          db.exec("DROP TABLE IF EXISTS stream_events_new");
          db.exec(
            "CREATE TABLE stream_events_new (" +
            "  id              INTEGER PRIMARY KEY," +
            "  task_id         INTEGER NULL REFERENCES tasks(id)," +
            "  conversation_id INTEGER NULL REFERENCES conversations(id)," +
            "  execution_id    INTEGER NOT NULL REFERENCES executions(id) ON DELETE CASCADE," +
            "  seq             INTEGER NOT NULL," +
            "  block_id        TEXT NOT NULL," +
            "  type            TEXT NOT NULL," +
            "  content         TEXT NOT NULL DEFAULT ''," +
            "  metadata        TEXT," +
            "  parent_block_id TEXT," +
            "  subagent_id     TEXT," +
            "  created_at      TEXT NOT NULL DEFAULT (datetime('now'))," +
            "  UNIQUE (execution_id, seq)" +
            ")"
          );
          db.exec(
            "INSERT OR IGNORE INTO stream_events_new" +
            " (id, task_id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at)" +
            " SELECT id, task_id, conversation_id, execution_id, seq, block_id, type, content, metadata, parent_block_id, subagent_id, created_at" +
            " FROM stream_events" +
            " WHERE conversation_id IS NOT NULL"
          );
          db.exec("DROP TABLE stream_events");
          db.exec("ALTER TABLE stream_events_new RENAME TO stream_events");
          db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_task ON stream_events(task_id, seq)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_conversation ON stream_events(conversation_id, seq)");
          db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_execution ON stream_events(execution_id, seq)");
        }

        db.run("INSERT INTO schema_migrations (id) VALUES (?)", [id]);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    return;
  }

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
      if (hasTable("tasks") && !hasColumn("tasks", "position")) {
        db.exec(sql);
      }
    } else if (id === "017_task_position_backfill") {
      if (hasTable("tasks")) {
        db.exec(sql);
      }
    } else if (id === "018_git_base_sha") {
      if (hasTable("task_git_context") && !hasColumn("task_git_context", "base_sha")) {
        db.exec(sql);
      }
    } else if (id === "019_add_parent_block_id") {
      if (hasTable("stream_events") && !hasColumn("stream_events", "parent_block_id")) {
        db.exec("ALTER TABLE stream_events ADD COLUMN parent_block_id TEXT");
      }
    } else if (id === "020_line_comment_columns") {
      if (hasTable("task_line_comments") && !hasColumn("task_line_comments", "col_start")) {
        db.exec("ALTER TABLE task_line_comments ADD COLUMN col_start INTEGER NOT NULL DEFAULT 0");
      }
      if (hasTable("task_line_comments") && !hasColumn("task_line_comments", "col_end")) {
        db.exec("ALTER TABLE task_line_comments ADD COLUMN col_end INTEGER NOT NULL DEFAULT 0");
      }
    } else if (id === "024_todo_v2") {
      if (hasTable("task_todos")) {
        if (!hasColumn("task_todos", "number")) {
          db.exec("ALTER TABLE task_todos ADD COLUMN number REAL NOT NULL DEFAULT 0");
          db.exec("UPDATE task_todos SET number = id");
        }
        if (!hasColumn("task_todos", "description")) {
          db.exec("ALTER TABLE task_todos ADD COLUMN description TEXT NOT NULL DEFAULT ''");
        }
        db.exec("UPDATE task_todos SET status = 'pending' WHERE status = 'not-started'");
        db.exec("UPDATE task_todos SET status = 'done' WHERE status = 'completed'");
      }
    } else if (id === "025_todo_phase") {
      if (hasTable("task_todos") && !hasColumn("task_todos", "phase")) {
        db.exec("ALTER TABLE task_todos ADD COLUMN phase TEXT NULL;");
      }
    } else if (id === "028_chat_session_mcp_tools") {
      if (hasTable("chat_sessions") && !hasColumn("chat_sessions", "enabled_mcp_tools")) {
        db.exec("ALTER TABLE chat_sessions ADD COLUMN enabled_mcp_tools TEXT NULL;");
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

  // In test mode (in-memory DB) seed a minimal board so the app boots into
  // BoardView instead of the first-time setup wizard.
  // Tests then create their own task rows via /setup-test-env.
  if (process.env.RAILYN_DB === ":memory:") {
    const workspaceKey = getDefaultWorkspaceKey();
    const hasBoard = db.query<{ id: number }, []>("SELECT id FROM boards LIMIT 1").get();
    if (!hasBoard) {
      db.run(
        "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES (?, 'Test Board', 'delivery', '[]')",
        [workspaceKey],
      );
      console.log("[db] Seeded test board");
    }
  }
}
