import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { TransitionEventMetadata } from "../../shared/rpc-types.ts";
import { resetConfig } from "../config/index.ts";
import { EngineRegistry } from "../engine/engine-registry.ts";
import { TransitionExecutor } from "../engine/execution/transition-executor.ts";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import { WorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import { WriteBuffer } from "../pipeline/write-buffer.ts";
import type { RawMessageItem } from "../engine/stream/raw-message-buffer.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, RawModelMessage } from "../engine/types.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";

const fakeRawBuffer = new WriteBuffer<RawMessageItem>({ flushFn: () => {} });

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
    task,
    conversationId,
    executionId,
    prompt,
    systemInstructions,
    workingDirectory,
    signal,
    onRawModelMessage,
    attachments,
  ) {
    const params = super.build(
      task,
      conversationId,
      executionId,
      prompt,
      systemInstructions,
      workingDirectory,
      signal,
      onRawModelMessage,
      attachments,
    );
    this.lastBuilt = params;
    return params;
  }
}

class StubWorkdirResolver extends WorkingDirectoryResolver {
  constructor(private readonly dir: string) {
    super();
  }

  override resolve(): string {
    return this.dir;
  }
}

class StubStreamProcessor extends StreamProcessor {
  lastRun: { taskId: number | null; conversationId: number; executionId: number; params: ExecutionParams } | null = null;

  constructor() {
    super(null as never, fakeRawBuffer, () => {}, () => {}, () => {}, () => {});
  }

  override createSignal(): AbortSignal {
    return new AbortController().signal;
  }

  override makePersistCallback(): (raw: RawModelMessage) => void {
    return (_raw) => {};
  }

  override runNonNative(
    taskId: number | null,
    conversationId: number,
    executionId: number,
    _engine: ExecutionEngine,
    params: ExecutionParams,
  ): void {
    this.lastRun = { taskId, conversationId, executionId, params };
  }
}

function readLatestTransitionMetadata(taskId: number): TransitionEventMetadata {
  const row = db
    .query<{ metadata: string | null }, [number]>(
      "SELECT metadata FROM conversation_messages WHERE task_id = ? AND type = 'transition_event' ORDER BY id DESC LIMIT 1",
    )
    .get(taskId);

  return JSON.parse(row?.metadata ?? "{}") as TransitionEventMetadata;
}

beforeEach(() => {
  db = initDb();
  gitDir = mkdtempSync(join(tmpdir(), "railyn-transition-"));
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

describe("TransitionExecutor", () => {
  it("keeps non-prompted transitions as basic transition events and idle tasks", async () => {
    const cfg = setupTestConfig("", gitDir);
    configCleanup = cfg.cleanup;
    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'plan' WHERE id = ?", [taskId]);

    const builder = new CapturingParamsBuilder();
    const streamProcessor = new StubStreamProcessor();
    const executor = new TransitionExecutor(
      db,
      EngineRegistry.fromFixed(new TestEngine()),
      builder,
      new StubWorkdirResolver(gitDir),
      streamProcessor,
    );

    const result = await executor.execute(taskId, "done");

    expect(result.executionId).toBeNull();
    expect(builder.lastBuilt).toBeNull();
    expect(streamProcessor.lastRun).toBeNull();

    const metadata = readLatestTransitionMetadata(taskId);
    expect(metadata).toEqual({ from: "plan", to: "done" });

    const promptRows = db
      .query<{ count: number }, [number]>(
        "SELECT count(*) AS count FROM conversation_messages WHERE task_id = ? AND type = 'user' AND role = 'prompt'",
      )
      .get(taskId);
    expect(promptRows?.count).toBe(0);
  });

  it("stores enriched transition metadata and resolves slash prompts for copilot execution", async () => {
    mkdirSync(join(gitDir, ".github", "prompts"), { recursive: true });
    writeFileSync(
      join(gitDir, ".github", "prompts", "opsx-propose.prompt.md"),
      "Expanded instructions for $input",
    );

    const cfg = setupTestConfig("", gitDir, [
      `id: slashy
name: Slashy
columns:
  - id: backlog
    label: Backlog
    is_backlog: true
  - id: plan
    label: Plan
    on_enter_prompt: "/opsx-propose transition card"
    stage_instructions: "You are a planning assistant."
`,
    ]);
    configCleanup = cfg.cleanup;

    const { taskId } = seedProjectAndTask(db, gitDir);
    db.run("UPDATE tasks SET workflow_state = 'backlog' WHERE id = ?", [taskId]);
    db.run("UPDATE boards SET workflow_template_id = 'slashy' WHERE id = (SELECT board_id FROM tasks WHERE id = ?)", [taskId]);

    const builder = new CapturingParamsBuilder();
    const streamProcessor = new StubStreamProcessor();
    const executor = new TransitionExecutor(
      db,
      EngineRegistry.fromFixed(new TestEngine()),
      builder,
      new StubWorkdirResolver(gitDir),
      streamProcessor,
    );

    const result = await executor.execute(taskId, "plan");

    expect(result.executionId).not.toBeNull();
    expect(builder.lastBuilt?.prompt).toBe("/opsx-propose transition card");
    expect(builder.lastBuilt?.workingDirectory).toBe(gitDir);

    const metadata = readLatestTransitionMetadata(taskId);
    expect(metadata).toEqual({
      from: "backlog",
      to: "plan",
      instructionDetail: {
        displayText: "Expanded instructions for transition card",
        sourceText: "/opsx-propose transition card",
        sourceKind: "slash",
        sourceRef: "/opsx-propose",
      },
    });

    const promptRows = db
      .query<{ count: number }, [number]>(
        "SELECT count(*) AS count FROM conversation_messages WHERE task_id = ? AND type = 'user' AND role = 'prompt'",
      )
      .get(taskId);
    expect(promptRows?.count).toBe(0);
  });
});
