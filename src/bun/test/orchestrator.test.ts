/**
 * Task 9.1: Native engine E2E tests via Orchestrator.
 *
 * Tests drive the engine through the Orchestrator public API
 * (executeTransition / executeHumanTurn / executeRetry / executeCodeReview / cancel)
 * using the fake AI provider — no real model calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { resetConfig, loadConfig } from "../config/index.ts";
import { Orchestrator } from "../engine/orchestrator.ts";
import type { Database } from "bun:sqlite";
import type { Task, ConversationMessage } from "../../shared/rpc-types.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput } from "../engine/types.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;
let orchestrator: Orchestrator;

function noop() { }

const tokens: string[] = [];
const taskUpdates: Task[] = [];
const newMessages: ConversationMessage[] = [];

class TestEngine implements ExecutionEngine {
  async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
    yield { type: "token", content: "Done." };
    yield { type: "done" };
  }
  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
  cancel(_executionId: number): void { }
  async listModels() {
    return [{ qualifiedId: "copilot/mock-model", displayName: "Mock Model", contextWindow: 128_000 }];
  }
  async listCommands() { return []; }
}

function makeOrchestrator(): Orchestrator {
  tokens.length = 0;
  taskUpdates.length = 0;
  newMessages.length = 0;

  return new Orchestrator(
    new TestEngine(),
    noop,
    (task) => taskUpdates.push(task),
    (msg) => newMessages.push(msg),
  );
}

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();

  gitDir = mkdtempSync(join(tmpdir(), "railyn-orch-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;");
  execSync("git add . && git commit -m init", { cwd: gitDir });

  orchestrator = makeOrchestrator();
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup();
});

// ─── executeTransition ───────────────────────────────────────────────────────

describe("Orchestrator.executeTransition", () => {
  it("updates workflow_state via configured engine", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
      [taskId, gitDir, gitDir],
    );

    const { task } = await orchestrator.executeTransition(taskId, "plan");

    expect(task.workflowState).toBe("plan");

    const row = db
      .query<{ workflow_state: string }, [number]>("SELECT workflow_state FROM tasks WHERE id = ?")
      .get(taskId);
    expect(row!.workflow_state).toBe("plan");
  });

  it("creates a transition_event message", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    await orchestrator.executeTransition(taskId, "plan");

    const event = db
      .query<{ type: string }, [number]>(
        "SELECT type FROM conversation_messages WHERE task_id = ? AND type = 'transition_event' LIMIT 1",
      )
      .get(taskId);
    expect(event).not.toBeNull();
  });

  it("returns null executionId for columns without on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const { executionId } = await orchestrator.executeTransition(taskId, "done");

    expect(executionId).toBeNull();
  });

  it("creates an execution for columns with on_enter_prompt", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);

    const { executionId } = await orchestrator.executeTransition(taskId, "plan");

    expect(executionId).not.toBeNull();
    expect(typeof executionId).toBe("number");
  }, 10_000);
});

// ─── executeHumanTurn ────────────────────────────────────────────────────────

describe("Orchestrator.executeHumanTurn", () => {
  it("appends user + assistant messages to DB", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => (resolveDone = resolve));

    orchestrator.setOnStreamEvent((event) => {
      if (event.done) resolveDone();
    });

    await orchestrator.executeHumanTurn(taskId, "What should I do first?");
    await donePromise;

    const userMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'user' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(userMsg!.content).toBe("What should I do first?");

    const assistantMsg = db
      .query<{ content: string }, [number]>(
        "SELECT content FROM conversation_messages WHERE task_id = ? AND type = 'assistant' ORDER BY id DESC LIMIT 1",
      )
      .get(taskId);
    expect(assistantMsg!.content.length).toBeGreaterThan(0);
  });

  it("creates an execution record", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const before = db
      .query<{ n: number }, [number]>("SELECT count(*) as n FROM executions WHERE task_id = ?")
      .get(taskId)!.n;

    await orchestrator.executeHumanTurn(taskId, "Go.");

    const after = db
      .query<{ n: number }, [number]>("SELECT count(*) as n FROM executions WHERE task_id = ?")
      .get(taskId)!.n;
    expect(after).toBe(before + 1);
  });

  it("persists conversation_id on task-backed executions", async () => {
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const { executionId } = await orchestrator.executeHumanTurn(taskId, "Go.");

    const row = db
      .query<{ task_id: number | null; conversation_id: number | null }, [number]>(
        "SELECT task_id, conversation_id FROM executions WHERE id = ?",
      )
      .get(executionId);

    expect(row).toEqual({ task_id: taskId, conversation_id: conversationId });
  });

  it("returns message and executionId", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const { message, executionId } = await orchestrator.executeHumanTurn(taskId, "Hello.");

    expect(message).toBeDefined();
    expect(message.taskId).toBe(taskId);
    expect(typeof executionId).toBe("number");
  });

  it("backfills a missing conversation for non-native human turns", async () => {
    class StubEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
      cancel(_executionId: number): void { }
      async listModels() { return []; }
    }

    const nonNative = new Orchestrator(
      new StubEngine(),
      noop,
      noop,
      (task) => taskUpdates.push(task),
      (msg) => newMessages.push(msg),
    );

    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan', conversation_id = NULL WHERE id = ?", [taskId]);
    db.run("UPDATE conversations SET task_id = 0 WHERE id = ?", [conversationId]);

    const { message } = await nonNative.executeHumanTurn(taskId, "Hello from legacy task.");

    const taskRow = db
      .query<{ conversation_id: number | null }, [number]>("SELECT conversation_id FROM tasks WHERE id = ?")
      .get(taskId);
    expect(taskRow?.conversation_id).not.toBeNull();
    expect(taskRow?.conversation_id).not.toBe(conversationId);
    expect(message.conversationId).toBe(taskRow!.conversation_id!);
  });
});

describe("Orchestrator.executeChatTurn", () => {
  it("persists conversation_id on session executions", async () => {
    db.run("INSERT INTO conversations (task_id) VALUES (NULL)");
    const conversationId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
    db.run(
      "INSERT INTO chat_sessions (workspace_key, title, status, conversation_id) VALUES ('default', 'Session', 'idle', ?)",
      [conversationId],
    );
    const sessionId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;

    const { executionId } = await orchestrator.executeChatTurn(sessionId, conversationId, "Hello from chat.");

    const row = db
      .query<{ task_id: number | null; conversation_id: number | null }, [number]>(
        "SELECT task_id, conversation_id FROM executions WHERE id = ?",
      )
      .get(executionId);

    expect(row).toEqual({ task_id: null, conversation_id: conversationId });
  });
});

describe("Orchestrator.respondShellApproval", () => {
  it("keeps waiting_user state when resume fails", async () => {
    let seededExecutionId = 0;
    class RejectingResumeEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {
        throw new Error(`Execution ${seededExecutionId} is not waiting for resume input`);
      }
      cancel(_executionId: number): void { }
      async listModels() { return []; }
    }

    const approvalOrchestrator = new Orchestrator(
      new RejectingResumeEngine(),
      noop,
      noop,
      (task) => taskUpdates.push(task),
      (msg) => newMessages.push(msg),
    );

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run(
      "INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, 'plan', 'plan', 'human-turn', 'waiting_user', 1)",
      [taskId],
    );
    const executionId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
    seededExecutionId = executionId;
    db.run(
      "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );

    await expect(approvalOrchestrator.respondShellApproval(taskId, "approve_once")).rejects.toThrow(
      `Execution ${executionId} is not waiting for resume input`,
    );

    const taskRow = db
      .query<{ execution_state: string; current_execution_id: number | null }, [number]>(
        "SELECT execution_state, current_execution_id FROM tasks WHERE id = ?",
      )
      .get(taskId);
    expect(taskRow).toEqual({ execution_state: "waiting_user", current_execution_id: executionId });

    const execRow = db
      .query<{ status: string; finished_at: string | null }, [number]>(
        "SELECT status, finished_at FROM executions WHERE id = ?",
      )
      .get(executionId);
    expect(execRow).toEqual({ status: "waiting_user", finished_at: null });
  });
});

// ─── executeRetry ─────────────────────────────────────────────────────────────

describe("Orchestrator.executeRetry", () => {
  it("creates a new execution", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
    // Seed a prior execution so retry has something to retry
    db.run(
      "INSERT INTO executions (task_id, from_state, to_state, status) VALUES (?, 'backlog', 'plan', 'failed')",
      [taskId],
    );
    const execBefore = db
      .query<{ id: number }, [number]>(
        "SELECT id FROM executions WHERE task_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(taskId)!.id;
    db.run("UPDATE tasks SET current_execution_id = ? WHERE id = ?", [execBefore, taskId]);

    const { executionId } = await orchestrator.executeRetry(taskId);

    expect(typeof executionId).toBe("number");
    expect(executionId).not.toBe(execBefore);
  }, 10_000);
});

// ─── cancel ──────────────────────────────────────────────────────────────────

describe("Orchestrator.cancel", () => {
  it("cancels an in-progress execution without throwing", async () => {
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    // Start a human turn and immediately cancel
    const turnPromise = orchestrator.executeHumanTurn(taskId, "Start processing.");
    const { executionId } = await turnPromise;

    // cancel should not throw
    expect(() => orchestrator.cancel(executionId)).not.toThrow();
  });

  it("is a no-op for unknown execution IDs", () => {
    expect(() => orchestrator.cancel(99999)).not.toThrow();
  });

  it("marks non-native executions cancelled immediately", () => {
    class CancelStubEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
      cancel(_executionId: number): void { }
      async listModels() { return []; }
    }

    const nonNative = new Orchestrator(
      new CancelStubEngine(),
      noop,
      noop,
      (task) => taskUpdates.push(task),
      (msg) => newMessages.push(msg),
    );

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run(
      "INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, 'plan', 'plan', 'human-turn', 'running', 1)",
      [taskId],
    );
    const executionId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
    db.run(
      "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
      [executionId, taskId],
    );

    expect(() => nonNative.cancel(executionId)).not.toThrow();

    const execRow = db
      .query<{ status: string; finished_at: string | null }, [number]>(
        "SELECT status, finished_at FROM executions WHERE id = ?",
      )
      .get(executionId);
    expect(execRow?.status).toBe("cancelled");
    expect(execRow?.finished_at).toBeTruthy();

    const taskRow = db
      .query<{ execution_state: string; current_execution_id: number | null }, [number]>(
        "SELECT execution_state, current_execution_id FROM tasks WHERE id = ?",
      )
      .get(taskId);
    expect(taskRow).toEqual({ execution_state: "waiting_user", current_execution_id: executionId });
  });
});

// ─── listModels ──────────────────────────────────────────────────────────────

describe("Orchestrator.listModels", () => {
  it("returns an array of EngineModelInfo", async () => {
    const models = await orchestrator.listModels();
    expect(Array.isArray(models)).toBe(true);
    for (const m of models) {
      expect(typeof m.qualifiedId).toBe("string");
      expect(m.qualifiedId.length).toBeGreaterThan(0);
      expect(m.contextWindow === null || typeof m.contextWindow === "number").toBe(true);
    }
  });
});

// ─── shutdownNonNativeEngines ──────────────────────────────────────────────

describe("Orchestrator.shutdownNonNativeEngines", () => {
  it("invokes shutdown on injected non-native engine", async () => {
    let shutdownCalls = 0;

    class ShutdownStubEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
      cancel(_executionId: number): void { }
      async listModels() { return []; }
      async shutdown(): Promise<void> { shutdownCalls += 1; }
    }

    const nonNative = new Orchestrator(
      new ShutdownStubEngine(),
      noop,
      noop,
      (task) => taskUpdates.push(task),
      (msg) => newMessages.push(msg),
    );

    await nonNative.shutdownNonNativeEngines({ reason: "app-exit", deadlineMs: 100 });
    expect(shutdownCalls).toBe(1);
  });

  it("ignores engines without shutdown hook", async () => {
    class NoShutdownEngine implements ExecutionEngine {
      async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
        yield { type: "done" };
      }
      async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
      cancel(_executionId: number): void { }
      async listModels() { return []; }
    }

    const nonNative = new Orchestrator(
      new NoShutdownEngine(),
      noop,
      noop,
      (task) => taskUpdates.push(task),
      (msg) => newMessages.push(msg),
    );

    await expect(nonNative.shutdownNonNativeEngines({ reason: "app-exit", deadlineMs: 100 })).resolves.toBeUndefined();
  });
});

// ─── Working-directory resolution ─────────────────────────────────────────────
//
// ⚠️  REGRESSION GUARD — this invariant has broken three times.
//
// The CWD passed to engine.execute() (via _resolveWorkingDirectory) MUST use
// the same priority as ClaudeEngine.listCommands():
//   1. projectPath  (workspace.yaml — the sub-application directory)
//   2. worktree_path (git worktree root — fallback)
//
// When a task lives inside a monorepo the worktree_path is the repo root while
// projectPath points to the specific sub-application (e.g. applications/broker).
// .claude/commands/ lives under the sub-application, so if worktree_path wins
// Claude starts in the wrong directory and every slash command becomes
// "Unknown skill" — even though the commands show up in autocomplete (because
// listCommands already resolved via projectPath).
//
// If you ever change _resolveWorkingDirectory or listCommands, keep both in sync.

describe("Orchestrator working-directory resolution", () => {
  let capturedWorkingDirectory: string | undefined;

  class CapturingEngine implements ExecutionEngine {
    async *execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
      capturedWorkingDirectory = params.workingDirectory;
      yield { type: "token", content: "ok" };
      yield { type: "done" };
    }
    async resume(_executionId: number, _input: EngineResumeInput): Promise<void> { }
    cancel(_executionId: number): void { }
    async listModels() {
      return [{ qualifiedId: "copilot/mock-model", displayName: "Mock", contextWindow: 128_000 }];
    }
    async listCommands() { return []; }
  }

  function makeCapturingOrchestrator() {
    capturedWorkingDirectory = undefined;
    return new Orchestrator(
      new CapturingEngine(),
      noop,
      noop,
      noop,
      noop,
    );
  }

  it("uses worktree_path when worktree is ready (single-repo)", async () => {
    // Core behaviour: when worktree_status = 'ready', CWD must be the worktree
    // so the agent's file edits stay isolated on the task branch instead of
    // modifying the main repository.
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-proj-"));
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));

    // setupTestConfig sets project_path = git_root_path = projectDir
    const localConfig = setupTestConfig("", projectDir);

    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, projectDir);
      localDb.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, projectDir, worktreeDir],
      );

      const orch = makeCapturingOrchestrator();
      await orch.executeHumanTurn(taskId, "run /opsx:explore");

      // relSubPath = relative(projectDir, projectDir) = "" → CWD = worktreeDir
      expect(capturedWorkingDirectory).toBe(worktreeDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });

  it("uses worktree_path + subdir when worktree is ready (monorepo)", async () => {
    // Monorepo: git_root_path = /gitroot, project_path = /gitroot/packages/app
    // Expected CWD in worktree: <worktreeDir>/packages/app
    const gitRootDir = mkdtempSync(join(tmpdir(), "railyn-gitroot-"));
    const projectDir = join(gitRootDir, "packages", "app");
    mkdirSync(projectDir, { recursive: true });
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));

    // Write config manually with differing project_path and git_root_path
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workflowsDir = join(configDir, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(configDir, "workspace.test.yaml"),
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        `    project_path: ${projectDir}`,
        `    git_root_path: ${gitRootDir}`,
        "    default_branch: main",
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(workflowsDir, "delivery.yaml"),
      [
        "id: delivery",
        "name: Delivery",
        "columns:",
        "  - id: backlog",
        "    label: Backlog",
        "    is_backlog: true",
        "  - id: plan",
        "    label: Plan",
        "    on_enter_prompt: 'Plan the task.'",
        "    stage_instructions: 'You are a planning assistant.'",
        "    allowed_transitions: [inprogress]",
        "  - id: done",
        "    label: Done",
      ].join("\n") + "\n",
    );
    process.env.RAILYN_CONFIG_DIR = configDir;
    process.env.RAILYN_SESSION_MEMORY_DIR = join(configDir, "tasks");
    resetConfig();
    loadConfig();

    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, projectDir);
      localDb.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, gitRootDir, worktreeDir],
      );

      const orch = makeCapturingOrchestrator();
      await orch.executeHumanTurn(taskId, "hello");

      // relSubPath = "packages/app" → CWD = <worktreeDir>/packages/app
      expect(capturedWorkingDirectory).toBe(join(worktreeDir, "packages", "app"));
    } finally {
      rmSync(gitRootDir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_SESSION_MEMORY_DIR;
      resetConfig();
    }
  });

  it("falls back to projectPath when worktree is not yet created", async () => {
    // Pre-worktree state (Backlog / plan column before worktree setup):
    // task_git_context row is absent or worktree_status != 'ready' → use projectPath
    const projectDir = mkdtempSync(join(tmpdir(), "railyn-proj-"));

    const localConfig = setupTestConfig("", projectDir);

    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, projectDir);
      localDb.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
      // Insert context row with non-ready status
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'not_created', 'test-branch')",
        [taskId, projectDir, null],
      );

      const orch = makeCapturingOrchestrator();
      await orch.executeHumanTurn(taskId, "hello");

      expect(capturedWorkingDirectory).toBe(projectDir);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });

  it("throws when projectPath is outside gitRootPath (misconfiguration)", async () => {
    // Safeguard: if relative(gitRootPath, projectPath) starts with "..", the
    // project lives outside the git repo — this is a config error.
    const gitRootDir = mkdtempSync(join(tmpdir(), "railyn-gitroot-"));
    const unrelatedDir = mkdtempSync(join(tmpdir(), "railyn-unrelated-"));
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));

    // Config maps project_path to a dir that's NOT under git_root_path
    const configDir = mkdtempSync(join(tmpdir(), "railyn-cfg-"));
    const workflowsDir = join(configDir, "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(
      join(configDir, "workspace.test.yaml"),
      [
        "name: test",
        "engine:",
        "  type: copilot",
        "  model: copilot/mock-model",
        "projects:",
        "  - key: test-project",
        "    name: Test Project",
        `    project_path: ${unrelatedDir}`,
        `    git_root_path: ${gitRootDir}`,
        "    default_branch: main",
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(workflowsDir, "delivery.yaml"),
      [
        "id: delivery",
        "name: Delivery",
        "columns:",
        "  - id: backlog",
        "    label: Backlog",
        "    is_backlog: true",
        "  - id: plan",
        "    label: Plan",
        "    on_enter_prompt: 'Plan the task.'",
        "    stage_instructions: 'You are a planning assistant.'",
        "    allowed_transitions: [inprogress]",
        "  - id: done",
        "    label: Done",
      ].join("\n") + "\n",
    );
    process.env.RAILYN_CONFIG_DIR = configDir;
    process.env.RAILYN_SESSION_MEMORY_DIR = join(configDir, "tasks");
    resetConfig();
    loadConfig();

    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, unrelatedDir);
      localDb.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, gitRootDir, worktreeDir],
      );

      const orch = makeCapturingOrchestrator();
      await expect(orch.executeHumanTurn(taskId, "hello")).rejects.toThrow("outside gitRootPath");
    } finally {
      rmSync(gitRootDir, { recursive: true, force: true });
      rmSync(unrelatedDir, { recursive: true, force: true });
      rmSync(worktreeDir, { recursive: true, force: true });
      rmSync(configDir, { recursive: true, force: true });
      delete process.env.RAILYN_CONFIG_DIR;
      delete process.env.RAILYN_SESSION_MEMORY_DIR;
      resetConfig();
    }
  });

  it("falls back to worktree_path when projectPath is not configured", async () => {
    const worktreeDir = mkdtempSync(join(tmpdir(), "railyn-wt-"));

    // Config has no project_path for this key — simulate by using an unknown project_key
    const localConfig = setupTestConfig("", worktreeDir);

    try {
      const localDb = initDb();
      const { taskId } = seedProjectAndTask(localDb, worktreeDir);
      localDb.run("UPDATE tasks SET workflow_state = 'plan', project_key = 'no-project-path' WHERE id = ?", [taskId]);
      localDb.run(
        "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, 'ready', 'test-branch')",
        [taskId, worktreeDir, worktreeDir],
      );

      const orch = makeCapturingOrchestrator();
      await orch.executeHumanTurn(taskId, "hello");

      expect(capturedWorkingDirectory).toBe(worktreeDir);
    } finally {
      rmSync(worktreeDir, { recursive: true, force: true });
      localConfig.cleanup();
    }
  });
});
