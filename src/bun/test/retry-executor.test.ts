import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetConfig } from "../config/index.ts";
import { EngineRegistry } from "../engine/engine-registry.ts";
import { RetryExecutor } from "../engine/execution/retry-executor.ts";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import { WorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, RawModelMessage } from "../engine/types.ts";
import type { TaskRow } from "../db/row-types.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";

let db: Database;
let gitDir: string;
let configCleanup: () => void;

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
    task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, onRawModelMessage, attachments,
  ) {
    const params = super.build(
      task, conversationId, executionId, prompt, systemInstructions, workingDirectory, signal, onRawModelMessage, attachments,
    );
    this.lastBuilt = params;
    return params;
  }
}

class StubWorkdirResolver extends WorkingDirectoryResolver {
  constructor(private readonly dir: string) { super(); }
  override resolve(): string { return this.dir; }
}

class StubStreamProcessor extends StreamProcessor {
  lastRun: { taskId: number | null; params: ExecutionParams } | null = null;

  constructor() { super(() => {}, () => {}, () => {}, () => {}); }

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
  gitDir = mkdtempSync(join(tmpdir(), "railyn-retry-"));
  execSync("git init", { cwd: gitDir });
  execSync('git config user.email "t@t.com"', { cwd: gitDir });
  execSync('git config user.name "T"', { cwd: gitDir });
  writeFileSync(join(gitDir, "index.ts"), "export const a = 1;\n");
});

afterEach(() => {
  rmSync(gitDir, { recursive: true, force: true });
  configCleanup?.();
  resetConfig("default");
});

function makeExecutor() {
  const builder = new CapturingParamsBuilder();
  const streamProcessor = new StubStreamProcessor();
  const executor = new RetryExecutor(
    db,
    EngineRegistry.fromFixed(new TestEngine()),
    builder,
    new StubWorkdirResolver(gitDir),
    streamProcessor,
  );
  return { builder, streamProcessor, executor };
}

describe("RetryExecutor — model resolution", () => {
  // RT-1: task already has model → uses task.model, no write-back
  it("uses task.model when task already has a model set", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = 'task/custom-model' WHERE id = ?", [taskId]);

    const { builder, executor } = makeExecutor();
    await executor.execute(taskId);

    expect(builder.lastBuilt?.model).toBe("task/custom-model");
    const row = db.query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?").get(taskId)!;
    expect(row.model).toBe("task/custom-model");
  });

  // RT-2: task.model null, engine.model configured → engine.model used + written to DB
  it("falls back to engine.model and writes it back to DB when task has no model", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = NULL WHERE id = ?", [taskId]);

    const { builder, executor } = makeExecutor();
    await executor.execute(taskId);

    expect(builder.lastBuilt?.model).toBe("copilot/mock-model");
    const row = db.query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?").get(taskId)!;
    expect(row.model).toBe("copilot/mock-model");
  });

  // RT-3: no model anywhere → empty string, DB stays NULL
  it("uses empty string when no model is configured anywhere", async () => {
    const cfg = setupTestConfig("", gitDir, [], null);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET model = NULL WHERE id = ?", [taskId]);

    const { builder, executor } = makeExecutor();
    await executor.execute(taskId);

    expect(builder.lastBuilt?.model).toBe("");
    const row = db.query<{ model: string | null }, [number]>("SELECT model FROM tasks WHERE id = ?").get(taskId)!;
    expect(row.model).toBeNull();
  });
});
