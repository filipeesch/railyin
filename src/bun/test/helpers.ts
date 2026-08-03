import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { tmpdir } from "os";
import { getDb, initDb as initDbProvider, _resetForTests as resetDbSingleton } from "../db/index.ts";
import type { Db } from "../db/db.ts";
import { runMigrations } from "../db/migrations/runner.ts";
import { resetConfig, loadConfig } from "../config/index.ts";

const SILENT_MIGRATION_LOGGER = { info() {}, warn() {} };

// ─── In-memory DB ─────────────────────────────────────────────────────────────

/**
 * Fresh in-memory `Db` with the real schema built by running the actual SQLite
 * migrations (decision #49 — no hand-maintained DDL copy, so the fixture cannot
 * drift from production).
 */
export async function initDb(): Promise<Db> {
  process.env.RAILYN_DB = ":memory:";
  resetDbSingleton();
  await initDbProvider();
  await runMigrations({ logger: SILENT_MIGRATION_LOGGER });
  return getDb();
}

// ─── Temp directory fixture ───────────────────────────────────────────────────

export function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "railyn-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ─── Seed a project + board + task ───────────────────────────────────────────

export async function seedProjectAndTask(
  db: Db,
  _gitRootPath: string,
  { workspaceKey = "default" }: { workspaceKey?: string } = {},
): Promise<{ projectKey: string; boardId: number; taskId: number; conversationId: number; workspaceKey: string }> {
  const projectKey = "test-project";

  const board = await db.get<{ id: number }>(
    "INSERT INTO boards (workspace_key, name, workflow_template_id) VALUES ($1, 'test-board', 'delivery') RETURNING id",
    [workspaceKey],
  );
  const boardId = board!.id;

  const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (0) RETURNING id");
  const conversationId = conv!.id;

  const task = await db.get<{ id: number }>(
    "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, conversation_id) VALUES ($1, $2, 'Test task', 'A test task', 'plan', 'idle', $3) RETURNING id",
    [boardId, projectKey, conversationId],
  );
  const taskId = task!.id;
  await db.exec("UPDATE conversations SET task_id = $1 WHERE id = $2", [taskId, conversationId]);

  return { projectKey, boardId, taskId, conversationId, workspaceKey };
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
export async function seedChatSession(
  db: Db,
  overrides: { workspaceKey?: string; title?: string; model?: string; lastEngineType?: string | null } = {},
): Promise<{ sessionId: number; conversationId: number }> {
  const workspaceKey = overrides.workspaceKey ?? "default";
  const title = overrides.title ?? "Test Session";

  const conv = await db.get<{ id: number }>("INSERT INTO conversations (task_id) VALUES (NULL) RETURNING id");
  const conversationId = conv!.id;

  if (overrides.model) {
    await db.exec("UPDATE conversations SET model = $1 WHERE id = $2", [overrides.model, conversationId]);
  }

  if (overrides.lastEngineType !== undefined) {
    await db.exec("UPDATE conversations SET last_engine_type = $1 WHERE id = $2", [overrides.lastEngineType, conversationId]);
  }

  const session = await db.get<{ id: number }>(
    "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ($1, $2, 'idle', $3) RETURNING id",
    [workspaceKey, title, conversationId],
  );
  const sessionId = session!.id;

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
