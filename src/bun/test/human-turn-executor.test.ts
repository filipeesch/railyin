import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetConfig } from "../config/index.ts";
import { HumanTurnExecutor } from "../engine/execution/human-turn-executor.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import type { OnTaskUpdated } from "../engine/types.ts";
import type { EngineRegistry } from "../engine/engine-registry.ts";
import type { Task } from "../../shared/rpc-types.ts";
import { initDb, seedProjectAndTask, setupTestConfig, makeTestRegistry, makeTestRegistryWith } from "./helpers.ts";
import { appendMessage } from "../conversation/messages.ts";
import { CrossEngineContextInjector } from "../conversation/cross-engine-context.ts";
import { ExecutionParamsEnricher } from "../engine/execution/execution-params-enricher.ts";
import { DecisionContextInjector } from "../conversation/decision-context-injector.ts";
import { CustomPromptInjector } from "../engine/execution/custom-prompt-injector.ts";
import { CapturingParamsBuilder, StubStreamProcessor, StubWorkdirResolver, TestEngine } from "./executor-test-helpers.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;
let wsRepo: WorkspaceRepository;
let boardTools: BoardToolExecutor;

beforeEach(() => {
  db = initDb();
  wsRepo = new WorkspaceRepository(db);
  boardTools = new BoardToolExecutor(db, wsRepo);
  gitDir = mkdtempSync(join(tmpdir(), "railyn-ht-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;\n");
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
  resetConfig();
});

function makeExecutor(engine: TestEngine, onTaskUpdated?: OnTaskUpdated, registry?: EngineRegistry) {
  const builder = new CapturingParamsBuilder();
  const streamProcessor = new StubStreamProcessor();
  const usedRegistry = registry ?? makeTestRegistry(engine);
  const executor = new HumanTurnExecutor(
    db,
    usedRegistry,
    builder,
    new StubWorkdirResolver(gitDir),
    streamProcessor,
    onTaskUpdated ?? (() => {}),
    wsRepo,
    boardTools,
    new CrossEngineContextInjector(db, usedRegistry),
    new DecisionContextInjector(db),
      new CustomPromptInjector(),
  );
  return { builder, streamProcessor, executor };
}

describe("HumanTurnExecutor — model resolution (normal path)", () => {
  // HT-1: task already has model → uses task.model, no DB write-back needed
  it("uses task.model when task already has a model set", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'task/custom-model' WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);

    const { builder, executor } = makeExecutor(new TestEngine());
    await executor.execute(taskId, "hello");

    expect(builder.lastBuilt?.model).toBe("task/custom-model");
    // No write-back needed since task already had model
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBe("task/custom-model");
  });

  // HT-2: task.model null, engine.model configured → uses empty string (no fallback)
  it("uses empty string when task has no model (no fallback to engine defaults)", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);

    const { builder, executor } = makeExecutor(new TestEngine());
    await executor.execute(taskId, "hello");

    expect(builder.lastBuilt?.model).toBe(""); // No fallback to engine model
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBeNull(); // DB remains NULL
  });

  // HT-4: no model anywhere → empty string, no DB write-back
  it("uses empty string when no model is configured anywhere", async () => {
    const cfg = setupTestConfig("", gitDir, [], null);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);

    const { builder, executor } = makeExecutor(new TestEngine());
    await executor.execute(taskId, "hello");

    expect(builder.lastBuilt?.model).toBe("");
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBeNull();
  });
});

describe("HumanTurnExecutor — model resolution (engine-lost fallback path)", () => {
  function seedWaitingUserTask(taskId: number) {
    // Insert a dummy execution in running state
    db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (?, (SELECT conversation_id FROM tasks WHERE id = ?), 'backlog', 'backlog', 'human-turn', 'running', 1)`,
      [taskId, taskId],
    );
    const execId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run("UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = ? WHERE id = ?", [execId, taskId]);
    return execId;
  }

  // HT-3: engine-lost fallback — task.model null, engine.model configured → write-back + engine.model used
  it("uses empty string in engine-lost path when no model is configured", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);
    seedWaitingUserTask(taskId);

    const { builder, executor } = makeExecutor(new TestEngine(true));
    await executor.execute(taskId, "continue please");

    expect(builder.lastBuilt?.model).toBe(""); // No fallback to engine model
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBeNull(); // DB remains NULL
  });
});

describe("HumanTurnExecutor — decision context injection", () => {
  it("HT-D-1: decisions block is prepended to prompt when decisions exist (first turn)", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);

    // Seed a decision record
    const convRow = db.query<{conversation_id: number}, [number]>("SELECT conversation_id FROM tasks WHERE id = ?").get(taskId)!;
    db.run(
      "INSERT INTO decision_records (conversation_id, question, answer, weight) VALUES (?, ?, ?, ?)",
      [convRow.conversation_id, "Test question?", "Test answer", "medium"],
    );

    const { builder, executor } = makeExecutor(new TestEngine());
    await executor.execute(taskId, "user prompt");

    expect(builder.lastBuilt?.prompt).toContain("## Decision Records");
    expect(builder.lastBuilt?.prompt).toContain("<decisions>");
  });

  it("HT-D-2: decisions block is NOT included when no decisions exist", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);

    const { builder, executor } = makeExecutor(new TestEngine());
    await executor.execute(taskId, "user prompt");

    expect(builder.lastBuilt?.prompt).not.toContain("## Decision Records");
    expect(builder.lastBuilt?.prompt).not.toContain("<decisions>");
  });

  it("HT-D-3: decisions not injected again on second turn (sentinel skips re-injection)", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);

    const convRow = db.query<{conversation_id: number}, [number]>("SELECT conversation_id FROM tasks WHERE id = ?").get(taskId)!;
    db.run(
      "INSERT INTO decision_records (conversation_id, question, answer, weight) VALUES (?, ?, ?, ?)",
      [convRow.conversation_id, "Test question?", "Test answer", "medium"],
    );

    const { builder, executor } = makeExecutor(new TestEngine());
    await executor.execute(taskId, "first message");
    expect(builder.lastBuilt?.prompt).toContain("## Decision Records");

    await executor.execute(taskId, "second message");
    expect(builder.lastBuilt?.prompt).not.toContain("## Decision Records");
  });
});

describe("HumanTurnExecutor — git context propagation via onTaskUpdated", () => {
  function seedGitContext(taskId: number) {
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, ?, ?)",
      [taskId, gitDir, "/wt/1", "ready", "feature/test"],
    );
  }

  function seedWaitingUserState(taskId: number, conversationId: number) {
    db.run(
      "INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt) VALUES (?, ?, 'plan', 'plan', 'human-turn', 'running', 1)",
      [taskId, conversationId],
    );
    const execId = (db.query<{ id: number }, []>("SELECT last_insert_rowid() as id").get()!).id;
    db.run(
      "UPDATE tasks SET execution_state = 'waiting_user', current_execution_id = ? WHERE id = ?",
      [execId, taskId],
    );
  }

  it("HT-GC-1: waiting_user resume broadcasts task with worktreePath via onTaskUpdated", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    seedWaitingUserState(taskId, conversationId);

    let capturedTask: Task | null = null;
    const { executor } = makeExecutor(new TestEngine(), (t) => { capturedTask = t; });

    await executor.execute(taskId, "hello");

    expect(capturedTask).not.toBeNull();
    expect(capturedTask!.worktreePath).toBe("/wt/1");
    expect(capturedTask!.worktreeStatus).toBe("ready");
  });

  it("HT-GC-2: session-lost fallback broadcasts task with worktreePath via onTaskUpdated", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);
    seedWaitingUserState(taskId, conversationId);

    const capturedTasks: Task[] = [];
    const { executor } = makeExecutor(new TestEngine(true), (t) => { capturedTasks.push(t); });

    await executor.execute(taskId, "hello");

    const broadcastForTask = capturedTasks.find(t => t.id === taskId);
    expect(broadcastForTask).toBeDefined();
    expect(broadcastForTask!.worktreePath).toBe("/wt/1");
  });

  it("HT-GC-3: new execution start broadcasts task with worktreePath via onTaskUpdated", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    seedGitContext(taskId);

    let capturedTask: Task | null = null;
    const { executor } = makeExecutor(new TestEngine(), (t) => { capturedTask = t; });

    await executor.execute(taskId, "hello");

    expect(capturedTask).not.toBeNull();
    expect(capturedTask!.worktreePath).toBe("/wt/1");
    expect(capturedTask!.worktreeStatus).toBe("ready");
  });
});

// ─── HT-CE-1..3: cross-engine context injection for human turns ──────────────

describe("HT-CE-1..3: cross-engine context injection on human turn", () => {
  it("HT-CE-1: prior copilot turns appear in prompt when engine switches (copilot → claude)", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'claude/opus', last_engine_type = 'copilot' WHERE id = ?", [conversationId]);
    appendMessage(db, taskId, conversationId, "assistant", null, "Copilot assistant response");

    const engine = new TestEngine();
    const registry = makeTestRegistryWith(new Map([["copilot", engine]]));
    const { builder, executor } = makeExecutor(engine, undefined, registry);

    await executor.execute(taskId, "new claude question");

    const prompt = builder.lastBuilt?.prompt ?? "";
    expect(prompt).toContain("<message_history>");
    expect(prompt).toContain("Copilot assistant response");
  });

  it("HT-CE-2: current user message is NOT inside <message_history> block", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'claude/opus', last_engine_type = 'copilot' WHERE id = ?", [conversationId]);
    appendMessage(db, taskId, conversationId, "assistant", null, "Copilot prior response");

    const engine = new TestEngine();
    const registry = makeTestRegistryWith(new Map([["copilot", engine]]));
    const { builder, executor } = makeExecutor(engine, undefined, registry);

    await executor.execute(taskId, "current user question");

    const prompt = builder.lastBuilt?.prompt ?? "";
    const historySection = prompt.includes("<message_history>")
      ? prompt.slice(prompt.indexOf("<message_history>"), prompt.indexOf("</message_history>"))
      : "";
    expect(historySection).not.toContain("current user question");
  });

  it("HT-CE-3: no engine switch (same engine) → no <message_history> injected", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId, conversationId } = seedProjectAndTask(db, gitDir);
    // last_engine_type = null means no prior engine, so no cross-engine injection
    db.run("UPDATE conversations SET model = 'claude/opus', last_engine_type = NULL WHERE id = ?", [conversationId]);
    appendMessage(db, taskId, conversationId, "assistant", null, "Some prior assistant response");

    const engine = new TestEngine();
    const registry = makeTestRegistryWith(new Map([["copilot", engine]]));
    const { builder, executor } = makeExecutor(engine, undefined, registry);

    await executor.execute(taskId, "user question with same engine");

    const prompt = builder.lastBuilt?.prompt ?? "";
    expect(prompt).not.toContain("<message_history>");
  });
});

// ─── HT-WK-1: workspaceKey propagation through human turn ──────────────

describe("HT-WK-1: workspaceKey propagation through human turn", () => {
  it("HT-WK-1: human turn preserves task's board workspaceKey", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan', execution_state = 'idle' WHERE id = ?", [taskId]);
    db.run("UPDATE boards SET workspace_key = 'ws-other' WHERE id = (SELECT board_id FROM tasks WHERE id = ?)", [taskId]);

    const builder = new CapturingParamsBuilder();
    const streamProcessor = new StubStreamProcessor();
    const executor = new HumanTurnExecutor(
      db,
      makeTestRegistry(new TestEngine()),
      builder,
      new StubWorkdirResolver(gitDir),
      streamProcessor,
      () => {},
      wsRepo,
      boardTools,
      new CrossEngineContextInjector(db),
      new DecisionContextInjector(db),
      new CustomPromptInjector(),
      undefined,
      undefined,
      new ExecutionParamsEnricher(db),
    );

    await executor.execute(taskId, "Hello from user");

    expect(builder.lastBuilt?.workspaceKey).toBe("ws-other");
  });
});
