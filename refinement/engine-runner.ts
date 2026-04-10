/**
 * refinement/engine-runner.ts
 *
 * Headless engine integration for local and live mode scenario execution.
 * Sets up a minimal in-memory DB + temp config pointing at the proxy,
 * then drives handleHumanTurn with the scenario's user prompt.
 *
 * Tasks 10.1–10.4.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { Database } from "bun:sqlite";

// Engine imports (task 10.1)
import { handleHumanTurn } from "../src/bun/workflow/engine.ts";
import { getDb, _resetForTests as resetDbSingleton } from "../src/bun/db/index.ts";
import { resetConfig, loadConfig } from "../src/bun/config/index.ts";
import type { ProxyMode, Scenario } from "./types.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

// ─── Minimal DB schema (mirrors src/bun/test/helpers.ts) ─────────────────────

function initMinimalDb(): Database {
  process.env.RAILYN_DB = ":memory:";
  resetDbSingleton();
  const db = getDb();
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, name TEXT NOT NULL,
      project_path TEXT NOT NULL, git_root_path TEXT NOT NULL, default_branch TEXT NOT NULL DEFAULT 'main',
      slug TEXT, description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, name TEXT NOT NULL,
      workflow_template_id TEXT NOT NULL, project_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, board_id INTEGER NOT NULL, project_id INTEGER NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', workflow_state TEXT NOT NULL DEFAULT 'backlog',
      execution_state TEXT NOT NULL DEFAULT 'idle', conversation_id INTEGER, current_execution_id INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0, created_from_task_id INTEGER, created_from_execution_id INTEGER,
      model TEXT, shell_auto_approve INTEGER NOT NULL DEFAULT 0, approved_commands TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_git_context (
      task_id INTEGER PRIMARY KEY, git_root_path TEXT NOT NULL, subrepo_path TEXT,
      branch_name TEXT, worktree_path TEXT, worktree_status TEXT NOT NULL DEFAULT 'not_created'
    );
    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, from_state TEXT NOT NULL,
      to_state TEXT NOT NULL, prompt_id TEXT, status TEXT NOT NULL DEFAULT 'running',
      attempt INTEGER NOT NULL DEFAULT 1, started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT, summary TEXT, details TEXT, cost_estimate REAL,
      input_tokens INTEGER, output_tokens INTEGER,
      cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER
    );
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, conversation_id INTEGER,
      execution_id INTEGER, type TEXT NOT NULL, role TEXT, content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), parent_id INTEGER,
      usage_input_tokens INTEGER, usage_output_tokens INTEGER,
      usage_cache_read_tokens INTEGER, usage_cache_creation_tokens INTEGER,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL DEFAULT 'info',
      task_id INTEGER, execution_id INTEGER,
      message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_hunk_decisions (
      task_id INTEGER NOT NULL, hunk_hash TEXT NOT NULL, file_path TEXT NOT NULL,
      reviewer_type TEXT NOT NULL DEFAULT 'human', reviewer_id TEXT NOT NULL DEFAULT 'user',
      decision TEXT NOT NULL DEFAULT 'pending', comment TEXT,
      original_start INTEGER NOT NULL DEFAULT 0, modified_start INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, hunk_hash, reviewer_id)
    );
    CREATE TABLE IF NOT EXISTS enabled_models (
      workspace_id INTEGER NOT NULL, qualified_model_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, qualified_model_id)
    );
    CREATE TABLE IF NOT EXISTS pending_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS task_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not-started', context TEXT, result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_todos_task ON task_todos(task_id);
  `);
  db.run("INSERT INTO workspaces (id, name) VALUES (1, 'refinement-workspace')");
  return db;
}

function seedTask(db: Database, gitRootPath: string, modelId: string): number {
  db.run("INSERT INTO projects (workspace_id, name, project_path, git_root_path, default_branch) VALUES (1, 'test', ?, ?, 'main')", [gitRootPath, gitRootPath]);
  const { id: projectId } = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  db.run("INSERT INTO boards (workspace_id, name, workflow_template_id) VALUES (1, 'test-board', 'delivery')");
  const { id: boardId } = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const { id: conversationId } = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  db.run(
    "INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state, conversation_id, model) VALUES (?, ?, 'Refinement task', 'Headless engine run', 'plan', 'idle', ?, ?)",
    [boardId, projectId, conversationId, modelId],
  );
  const { id: taskId } = db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!;
  db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);
  db.run(
    "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
    [taskId, gitRootPath, gitRootPath],
  );
  return taskId;
}

// Task 10.2: configure engine to use proxy endpoint as base_url
function setupEngineConfig(
  proxyUrl: string,
  modelId: string,
  configDir: string,
  columnTools: string[] = ["read", "write", "search", "shell", "interactions", "agents"],
): () => void {
  const [providerId] = modelId.split("/");
  writeFileSync(
    join(configDir, "workspace.test.yaml"),
    [
      "name: refinement",
      "providers:",
      `  - id: ${providerId}`,
      "    type: anthropic",
      "    api_key: refinement-harness",
      `    base_url: ${proxyUrl}`,
    ].join("\n") + "\n",
  );
  const workflowsDir = join(configDir, "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  const toolsYaml = columnTools.map((t) => `      - ${t}`).join("\n");
  writeFileSync(
    join(workflowsDir, "delivery.yaml"),
    `id: delivery
name: Delivery
columns:
  - id: plan
    label: Plan
    on_enter_prompt: "Execute the task."
    stage_instructions: "You are a helpful assistant. Use the provided tools to complete tasks."
    allowed_transitions: [done]
    tools:
${toolsYaml}
  - id: done
    label: Done
`,
  );
  process.env.RAILYN_CONFIG_DIR = configDir;
  resetConfig();
  loadConfig();
  return () => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env.RAILYN_CONFIG_DIR;
    resetConfig();
  };
}

export interface EngineRunResult {
  /** Tool names observed in recorded tool_use blocks */
  toolNames: string[];
  /** Tool results (tool name + result string) */
  toolResults: Array<{ tool: string; result: string }>;
  /** Final assistant text response */
  finalText: string;
  /** Whether the run completed (stop_reason=end_turn on the last request). */
  completed: boolean;
}

/** Aggregate result across multiple runs (for local/live two-run mode). */
export interface MultiRunResult {
  runs: Array<EngineRunResult & { run: number; rounds: number }>;
  avg_rounds: number;
  min_rounds: number;
  max_rounds: number;
  rounds_variance: number;
  completion_rate: number;
  all_tool_names: string[];
}

/** Copy a fixture directory into the temp git working tree. */
function copyFixtures(fixtureName: string, gitDir: string): void {
  const srcDir = join(FIXTURES_DIR, fixtureName);
  if (!existsSync(srcDir)) {
    console.warn(`[engine-runner] fixture '${fixtureName}' not found at ${srcDir} — skipping`);
    return;
  }
  cpSync(srcDir, gitDir, { recursive: true });
}

/** Determine user prompt messages for a scenario run (mode-aware). */
function getUserMessages(scenario: Scenario, mode: ProxyMode): Array<{ content: string }> {
  // local/live/real-codebase: prefer scenario.prompt (single real task prompt)
  if (mode !== "mock" && scenario.prompt) {
    return [{ content: scenario.prompt.trim() }];
  }
  // mock: use script user entries
  return (scenario.script ?? []).filter((e) => e.role === "user").map((e) => ({ content: e.content ?? "" }));
}

/** Run a scenario through the engine once. Returns EngineRunResult. */
export async function runScenarioThroughEngine(
  scenario: Scenario,
  proxyUrl: string,
  modelId: string = "anthropic/claude-3-5-sonnet-20241022",
  mode: ProxyMode = "mock",
  worktreePath?: string,
): Promise<EngineRunResult> {
  const userMessages = getUserMessages(scenario, mode);
  if (userMessages.length === 0) {
    return { toolNames: [], toolResults: [], finalText: "", completed: false };
  }

  const columnTools = scenario.column_tools ?? ["read", "write", "search", "shell", "interactions", "agents"];

  // Set up isolated environment
  process.env.RAILYN_DB = ":memory:";

  const configDir = mkdtempSync(join(tmpdir(), "railyn-refine-cfg-"));

  // Use worktreePath if provided (real-codebase scenarios), otherwise create a temp git repo
  let gitDir: string;
  let cleanupGitDir: (() => void) | null = null;

  if (worktreePath) {
    gitDir = worktreePath;
  } else {
    gitDir = mkdtempSync(join(tmpdir(), "railyn-refine-git-"));
    cleanupGitDir = () => rmSync(gitDir, { recursive: true, force: true });
  }

  const cleanup = () => {
    rmSync(configDir, { recursive: true, force: true });
    cleanupGitDir?.();
    delete process.env.RAILYN_DB;
    resetDbSingleton();
    resetConfig();
  };

  if (!worktreePath) {
    execSync("git init", { cwd: gitDir });
    execSync('git config user.email "refine@test.com"', { cwd: gitDir });
    execSync('git config user.name "Refinement"', { cwd: gitDir });
    writeFileSync(join(gitDir, "README.md"), "# Refinement test repo\n");

    // Copy fixtures for local/live mode (task 5.4)
    if (mode !== "mock" && scenario.fixtures) {
      copyFixtures(scenario.fixtures, gitDir);
    }

    execSync("git add -A && git commit -m init", { cwd: gitDir });
  }

  const configCleanup = setupEngineConfig(proxyUrl, modelId, configDir, columnTools);
  const db = initMinimalDb();
  const taskId = seedTask(db, gitDir, modelId);

  const result: EngineRunResult = { toolNames: [], toolResults: [], finalText: "", completed: false };
  const tokens: string[] = [];

  try {
    for (const msg of userMessages) {
      // handleHumanTurn fires runExecution async; await its completion via onTaskUpdated
      let resolveExec!: () => void;
      const execDone = new Promise<void>((r) => { resolveExec = r; });

      await handleHumanTurn(
        taskId,
        msg.content,
        (_taskId, _execId, token, done) => { if (!done) tokens.push(token); },
        (_, __, err) => { console.error(`[engine] error: ${err}`); resolveExec(); },
        (task: { executionState: string }) => {
          if (task.executionState === "completed" || task.executionState === "failed" || task.executionState === "idle" || task.executionState === "waiting_user") {
            result.completed = task.executionState === "completed";
            resolveExec();
          }
        },
        (message) => {
          if (message.type === "tool_call") {
            result.toolNames.push((message as { content?: string }).content?.match(/"name":"([^"]+)"/)?.at(1) ?? "unknown");
          }
          if (message.type === "tool_result") {
            const content = (message as { content?: string }).content ?? "";
            const toolName = result.toolNames.at(-1) ?? "unknown";
            result.toolResults.push({ tool: toolName, result: content });
          }
        },
      );

      await execDone;
    }
    result.finalText = tokens.join("");
  } finally {
    configCleanup();
    cleanup();
  }

  return result;
}

/**
 * Run a scenario twice (for local/live mode) and aggregate results.
 * The proxy state (request counts) is managed externally — this just
 * calls runScenarioThroughEngine twice with reset between runs.
 */
export async function runScenarioTwice(
  scenario: Scenario,
  proxyUrl: string,
  modelId: string,
  mode: ProxyMode,
  onRun: (run: number) => void,
): Promise<MultiRunResult> {
  const runResults: Array<EngineRunResult & { run: number; rounds: number }> = [];

  for (let i = 1; i <= 2; i++) {
    onRun(i);
    const r = await runScenarioThroughEngine(scenario, proxyUrl, modelId, mode);
    // rounds = tool names length + 1 (final text response) — approximate
    // The accurate round count is from proxy records, captured externally
    runResults.push({ ...r, run: i, rounds: 0 /* populated by caller from proxy */ });
  }

  const completedCount = runResults.filter((r) => r.completed).length;
  const roundCounts = runResults.map((r) => r.rounds);
  const avgRounds = roundCounts.reduce((s, v) => s + v, 0) / runResults.length;
  const minRounds = Math.min(...roundCounts);
  const maxRounds = Math.max(...roundCounts);
  const variance = roundCounts.reduce((s, v) => s + Math.pow(v - avgRounds, 2), 0) / runResults.length;

  return {
    runs: runResults,
    avg_rounds: avgRounds,
    min_rounds: minRounds,
    max_rounds: maxRounds,
    rounds_variance: Math.sqrt(variance),
    completion_rate: completedCount / runResults.length,
    all_tool_names: [...new Set(runResults.flatMap((r) => r.toolNames))],
  };
}
