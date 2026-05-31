import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { ChatExecutor } from "../engine/execution/chat-executor.ts";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import { ExecutionParamsEnricher } from "../engine/execution/execution-params-enricher.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { CustomPromptInjector } from "../engine/execution/custom-prompt-injector.ts";
import { NullModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import type { IWorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, RawModelMessage } from "../engine/types.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import { initDb, setupTestConfig, makeTestRegistry, seedChatSession } from "./helpers.ts";
import { resetConfig } from "../config/index.ts";

let db: Database;
let configCleanup: (() => void) | undefined;

// ─── Test doubles ─────────────────────────────────────────────────────────────

class PassThroughEngine implements ExecutionEngine {
  async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> {
    yield { type: "done" };
  }
  async resume(): Promise<void> {}
  cancel(): void {}
  async listModels() { return []; }
  async listCommands() { return []; }
}

class StubWorkdirResolver implements IWorkingDirectoryResolver {
  constructor(private readonly dir: string = "/tmp") {}
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
    return () => {};
  }

  override runNonNative(taskId: number | null, _conversationId: number, _executionId: number, _engine: ExecutionEngine, params: ExecutionParams): void {
    this.lastRun = { taskId, params };
  }
}

/** Returns a ModelSettingsRepository that always returns a fixed context window value. */
function fixedContextWindowRepo(value: number): ModelSettingsRepository {
  return {
    getContextWindow: () => value,
    setContextWindow: () => {},
  };
}

function makeExecutor(opts: {
  modelSettingsRepo?: ModelSettingsRepository;
  boardTools?: BoardToolExecutor;
  onNewMessage?: (msg: ConversationMessage) => void;
  streamProcessor?: StubStreamProcessor;
}): { executor: ChatExecutor; streamProcessor: StubStreamProcessor } {
  const streamProcessor = opts.streamProcessor ?? new StubStreamProcessor();
  const paramsEnricher = opts.modelSettingsRepo
    ? new ExecutionParamsEnricher(db, opts.modelSettingsRepo)
    : undefined;
  const executor = new ChatExecutor(
    db,
    makeTestRegistry(new PassThroughEngine()),
    new ExecutionParamsBuilder(null),
    streamProcessor,
    new StubWorkdirResolver(),
    new CustomPromptInjector(),
    paramsEnricher,
    opts.boardTools,
    opts.onNewMessage,
  );
  return { executor, streamProcessor };
}

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
});

afterEach(() => {
  configCleanup?.();
  resetConfig();
});

// ─── CE-1: contextWindowOverride is injected into ExecutionParams ─────────────

describe("CE-1: contextWindowOverride injected when configured", () => {
  it("passes contextWindowOverride from ModelSettingsRepository into ExecutionParams", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/mock-model" });
    const { executor, streamProcessor } = makeExecutor({ modelSettingsRepo: fixedContextWindowRepo(32768) });

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.contextWindowOverride).toBe(32768);
  });

  it("leaves contextWindowOverride undefined when ModelSettingsRepository returns null", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/mock-model" });
    const { executor, streamProcessor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.contextWindowOverride).toBeUndefined();
  });
});

// ─── CE-2: boardTools is injected into ExecutionParams ────────────────────────

describe("CE-2: boardTools injected into ExecutionParams", () => {
  it("passes boardTools instance into ExecutionParams", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/mock-model" });
    const wsRepo = new WorkspaceRepository(db);
    const boardTools = new BoardToolExecutor(db, wsRepo);
    const { executor, streamProcessor } = makeExecutor({ boardTools });

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.boardTools).toBe(boardTools);
  });

  it("does not set boardTools when not provided", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/mock-model" });
    const { executor, streamProcessor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.boardTools).toBeUndefined();
  });
});

// ─── CE-3: pre-flight fires for Pi + no context window ───────────────────────

describe("CE-3: pre-flight fires for Pi + no context window", () => {
  it("does not create an executions row when Pi has no context window", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "pi/some-model" });
    const { executor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    const execRow = db.query<{ id: number }, [number]>(
      "SELECT id FROM executions WHERE conversation_id = ?",
    ).get(conversationId);
    expect(execRow).toBeNull();
  });

  it("persists a system message when Pi has no context window", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "pi/some-model" });
    const { executor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    const systemMsg = db.query<{ type: string; content: string }, [number]>(
      "SELECT type, content FROM conversation_messages WHERE conversation_id = ? AND type = 'system'",
    ).get(conversationId);
    expect(systemMsg).not.toBeNull();
    expect(systemMsg!.type).toBe("system");
    expect(systemMsg!.content).toContain("pi/some-model");
  });

  it("resets chat_sessions status to idle after pre-flight error", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "pi/some-model" });
    const { executor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    const session = db.query<{ status: string }, [number]>(
      "SELECT status FROM chat_sessions WHERE id = ?",
    ).get(sessionId);
    expect(session?.status).toBe("idle");
  });
});

// ─── CE-4: onNewMessage called on pre-flight failure ─────────────────────────

describe("CE-4: onNewMessage called exactly once on pre-flight failure", () => {
  it("calls onNewMessage with a system-typed ConversationMessage", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "pi/some-model" });
    const captured: ConversationMessage[] = [];
    const { executor } = makeExecutor({
      modelSettingsRepo: new NullModelSettingsRepository(),
      onNewMessage: (msg) => captured.push(msg),
    });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    expect(captured).toHaveLength(1);
    expect(captured[0].type).toBe("system");
    expect(captured[0].content).toContain("pi/some-model");
  });
});

// ─── CE-5: pre-flight does NOT fire for Pi with configured context window ─────

describe("CE-5: pre-flight passes for Pi when context window is configured", () => {
  it("proceeds to execution when Pi has a configured context window", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "pi/some-model" });
    const { executor, streamProcessor } = makeExecutor({ modelSettingsRepo: fixedContextWindowRepo(8192) });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    expect(streamProcessor.lastRun).not.toBeNull();
  });

  it("does not persist a system error message when context window is configured", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "pi/some-model" });
    const { executor } = makeExecutor({ modelSettingsRepo: fixedContextWindowRepo(8192) });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    const systemMsg = db.query<{ id: number }, [number]>(
      "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'system'",
    ).get(conversationId);
    expect(systemMsg).toBeNull();
  });
});

// ─── CE-6: pre-flight does NOT fire for non-Pi engines ───────────────────────

describe("CE-6: pre-flight does NOT fire for non-Pi engines (e.g. copilot)", () => {
  it("proceeds to execution even when copilot model has no context window configured", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/gpt-4o" });
    const { executor, streamProcessor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "copilot/gpt-4o");

    expect(streamProcessor.lastRun).not.toBeNull();
  });

  it("does not persist a system error message for non-Pi engines", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/gpt-4o" });
    const { executor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "copilot/gpt-4o");

    const systemMsg = db.query<{ id: number }, [number]>(
      "SELECT id FROM conversation_messages WHERE conversation_id = ? AND type = 'system'",
    ).get(conversationId);
    expect(systemMsg).toBeNull();
  });
});

// ─── CE-7: onNewMessage NOT called during pre-flight on successful execution ──

describe("CE-7: onNewMessage not called in pre-flight phase on successful execution", () => {
  it("does not call onNewMessage when execution proceeds normally", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/gpt-4o" });
    let called = false;
    const { executor } = makeExecutor({
      modelSettingsRepo: new NullModelSettingsRepository(),
      onNewMessage: () => { called = true; },
    });

    await executor.execute(sessionId, conversationId, "hello", "copilot/gpt-4o");

    expect(called).toBe(false);
  });
});
