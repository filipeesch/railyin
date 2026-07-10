import { initDb } from "./helpers.ts";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import type { IWorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, RawModelMessage } from "../engine/types.ts";

export class TestEngine implements ExecutionEngine {
  constructor(private readonly throwOnResume = false) {}

  async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
    yield { type: "done" };
  }

  async resume(_executionId: number, _input: EngineResumeInput): Promise<void> {
    if (this.throwOnResume) throw new Error("Engine session lost");
  }

  cancel(_executionId: number): void {}
  async listModels() { return []; }
  async listCommands(_taskId: number) { return []; }
}

export class CapturingParamsBuilder extends ExecutionParamsBuilder {
  lastBuilt: ExecutionParams | null = null;

  override build(
    task: import("../db/row-types.ts").TaskRow,
    conversationId: number,
    executionId: number,
    prompt: string,
    systemInstructions: string | undefined,
    workingDirectory: string,
    signal: AbortSignal,
    onRawModelMessage: (raw: RawModelMessage) => void,
    attachments?: import("../../shared/rpc-types.ts").Attachment[],
    model?: string,
    projectPath?: string,
    workspaceKey?: string,
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
      model,
      projectPath,
      workspaceKey,
    );
    this.lastBuilt = params;
    return params;
  }
}

export class StubWorkdirResolver implements IWorkingDirectoryResolver {
  constructor(private readonly dir: string) {}
  resolve(): string { return this.dir; }
}

export class StubStreamProcessor extends StreamProcessor {
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
