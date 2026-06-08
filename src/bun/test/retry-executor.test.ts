import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetConfig } from "../config/index.ts";
import { RetryExecutor } from "../engine/execution/retry-executor.ts";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import { IWorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { BoardRepository } from "../db/board-repository.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, RawModelMessage } from "../engine/types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { initDb, seedProjectAndTask, setupTestConfig, makeTestRegistry } from "./helpers.ts";
import { CustomPromptInjector } from "../engine/execution/custom-prompt-injector.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;
let wsRepo: WorkspaceRepository;
let boardTools: BoardToolExecutor;

class TestEngine implements ExecutionEngine {
  async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
    yield { type: "done" };
  }
  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {}
  cancel(_executionId: number): void {}
  async listModels() { return []; }
  async listCommands(_taskId: number) { return []; }
}

class CapturingParamsBuilder extends ExecutionParamsBuilder {
  lastBuilt: ExecutionParams | null = null;

  override build(
    task: TaskRow, conversationId: number, executionId: number, prompt: string, systemInstructions: string | undefined, workingDirectory: string, signal: AbortSignal, onRawModelMessage: (raw: RawModelMessage) => void, attachments?: import("../../shared/rpc-types.ts").Attachment[],
  ) {
    const params = super.build(
      task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, onRawModelMessage, attachments,
    );
    this.lastBuilt = params;
    return params;
  }
}

class StubWorkdirResolver implements IWorkingDirectoryResolver {
  constructor(private readonly dir: string) {}
  resolve(): string { return this.dir; }
}

class StubStreamProcessor extends StreamProcessor {
  lastRun: { taskId: number | null; params: ExecutionParams } | null = null;

  constructor() {
    const _db = initDb();
    const _rawBuf = { enqueue() {}, flush: async () => {} } as unknown as import("../pipeline/write-buffer.ts").WriteBuffer<import("../engine/stream/raw-message-buffer.ts").RawMessageItem>;
    super(_db, _rawBuf, () => {}, () => {}, () => {}, () => {});
  }

  override createSignal(_executionId: number): AbortSignal {
    return new AbortController().signal;
  }

  override makePersistCallback(_taskId: number | null, _conversationId: number, _executionId: number): (raw: RawModelMessage) => void {
    return (_raw) => {};
  }

  override runNonNative(taskId: number | null, _conversationId: number, _executionId: number, _engine: ExecutionEngine, params: ExecutionParams): void {
    this.lastRun = { taskId, params };
  }
}

beforeEach(() => {
  db = initDb();
  wsRepo = new WorkspaceRepository(db);
  boardTools = new BoardToolExecutor(db, wsRepo, new BoardRepository(db));
  gitDir = mkdtempSync(join(tmpdir(), "railyn-retry-"));
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

function makeExecutor() {
  const builder = new CapturingParamsBuilder();
  const streamProcessor = new StubStreamProcessor();
  const executor = new RetryExecutor(
    db,
    makeTestRegistry(new TestEngine()),
    builder,
    new StubWorkdirResolver(gitDir),
    streamProcessor,
    wsRepo,
    boardTools,
    new CustomPromptInjector(),
  );
  return { builder, streamProcessor, executor };
}

describe("RetryExecutor — model resolution", () => {
  // RT-1: task already has model → uses task.model, no write-back
  it("uses task.model when task already has a model set", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = 'task/custom-model' WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);

    const { builder, executor } = makeExecutor();
    await executor.execute(taskId);

    expect(builder.lastBuilt?.model).toBe("task/custom-model");
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBe("task/custom-model");
  });

  // RT-2: task.model null, engine.model configured → uses empty string (no fallback)
  it("uses empty string when task has no model (no fallback to engine defaults)", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);

    const { builder, executor } = makeExecutor();
    await executor.execute(taskId);

    expect(builder.lastBuilt?.model).toBe(""); // No fallback to engine model
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBeNull(); // DB remains NULL
  });

  // RT-3: no model anywhere → empty string, DB stays NULL
  it("uses empty string when no model is configured anywhere", async () => {
    const cfg = setupTestConfig("", gitDir, [], null);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE conversations SET model = NULL WHERE id = (SELECT conversation_id FROM tasks WHERE id = ?)", [taskId]);

    const { builder, executor } = makeExecutor();
    await executor.execute(taskId);

    expect(builder.lastBuilt?.model).toBe("");
    const row = db.query<{ model: string | null }, [number]>("SELECT c.model FROM conversations c JOIN tasks t ON c.id = t.conversation_id WHERE t.id = ?").get(taskId)!;
    expect(row.model).toBeNull();
  });
});

describe("RetryExecutor — git context propagation", () => {
  it("RE-GC-1: retry returns task with worktreePath when task_git_context row exists", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run(
      "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status, branch_name) VALUES (?, ?, ?, ?, ?)",
      [taskId, "/tmp/git-root", "/wt/1", "ready", "feature/test"],
    );

    const { executor } = makeExecutor();
    const result = await executor.execute(taskId);

    expect(result.task.worktreePath).toBe("/wt/1");
  });
});
