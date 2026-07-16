import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "bun:sqlite";
import { ChatExecutor } from "../engine/execution/chat-executor.ts";
import { ExecutionParamsBuilder } from "../engine/execution/execution-params-builder.ts";
import { ExecutionParamsEnricher } from "../engine/execution/execution-params-enricher.ts";
import { StreamProcessor } from "../engine/stream/stream-processor.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { CustomPromptInjector } from "../engine/execution/custom-prompt-injector.ts";
import { CrossEngineContextInjector } from "../conversation/cross-engine-context.ts";
import { NullModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import type { IWorkingDirectoryResolver } from "../engine/execution/working-directory-resolver.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, RawModelMessage } from "../engine/types.ts";
import type { ConversationMessage } from "../../shared/rpc-types.ts";
import { initDb, setupTestConfig, makeTestRegistry, makeTestRegistryWith, seedChatSession, seedMessage } from "./helpers.ts";
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
  crossEngineInjector?: CrossEngineContextInjector;
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
    opts.crossEngineInjector ?? new CrossEngineContextInjector(db, makeTestRegistry(new PassThroughEngine())),
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

// ─── CE-8: historyBlock injected into params.prompt on engine switch ──────────

describe("CE-8: historyBlock injected into params.prompt on engine switch", () => {
  it("params.prompt contains <message_history> when last_engine_type differs from target engine", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "copilot/mock-model",
      lastEngineType: "claude",
    });
    const { executor, streamProcessor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.prompt).toContain("<message_history>");
  });

  it("params.prompt starts with the engine-switch context header on switch", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "copilot/mock-model",
      lastEngineType: "claude",
    });
    const { executor, streamProcessor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.prompt).toContain(
      "## Context from previous conversation (engine switch)",
    );
  });
});

// ─── CE-9: no injection when same engine ──────────────────────────────────────

describe("CE-9: no historyBlock injection when last_engine_type matches target engine", () => {
  it("params.prompt equals the raw user content when engine has not changed", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "copilot/mock-model",
      lastEngineType: "copilot",
    });
    const { executor, streamProcessor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.prompt).toBe("hello");
  });
});

// ─── CE-10: no injection on first turn (null last_engine_type) ────────────────

describe("CE-10: no historyBlock injection on first turn (null last_engine_type)", () => {
  it("params.prompt equals the raw user content when last_engine_type is null", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/mock-model" });
    const { executor, streamProcessor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    expect(streamProcessor.lastRun).not.toBeNull();
    expect(streamProcessor.lastRun!.params.prompt).toBe("hello");
  });
});

// ─── CE-11: historyBlock not stored in conversation_messages ─────────────────

describe("CE-11: historyBlock not stored in user conversation_messages row", () => {
  it("the persisted user message content equals the original input, not the injected prompt", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "copilot/mock-model",
      lastEngineType: "claude",
    });
    const { executor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    const userMsg = db.query<{ content: string }, [number]>(
      "SELECT content FROM conversation_messages WHERE conversation_id = ? AND type = 'user'",
    ).get(conversationId);
    expect(userMsg).not.toBeNull();
    expect(userMsg!.content).toBe("hello");
    expect(userMsg!.content).not.toContain("<message_history>");
  });
});

// ─── CE-12: conversations.last_engine_type written after execute ──────────────

describe("CE-12: conversations.last_engine_type written after execute", () => {
  it("sets last_engine_type to 'copilot' after executing with 'copilot/mock-model'", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/mock-model" });
    const { executor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/mock-model");

    const row = db.query<{ last_engine_type: string | null }, [number]>(
      "SELECT last_engine_type FROM conversations WHERE id = ?",
    ).get(conversationId);
    expect(row?.last_engine_type).toBe("copilot");
  });

  it("updates last_engine_type to 'claude' after switching from copilot to 'claude/claude-sonnet-4-5'", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "copilot/mock-model",
      lastEngineType: "copilot",
    });
    const { executor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "claude/claude-sonnet-4-5");

    const row = db.query<{ last_engine_type: string | null }, [number]>(
      "SELECT last_engine_type FROM conversations WHERE id = ?",
    ).get(conversationId);
    expect(row?.last_engine_type).toBe("claude");
  });
});

// ─── CE-13: last_engine_type NOT written on Pi pre-flight failure ─────────────

describe("CE-13: last_engine_type not written when Pi pre-flight exits early", () => {
  it("leaves last_engine_type unchanged when Pi engine has no configured context window", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "pi/some-model",
      lastEngineType: "copilot",
    });
    const { executor } = makeExecutor({ modelSettingsRepo: new NullModelSettingsRepository() });

    await executor.execute(sessionId, conversationId, "hello", "pi/some-model");

    const row = db.query<{ last_engine_type: string | null }, [number]>(
      "SELECT last_engine_type FROM conversations WHERE id = ?",
    ).get(conversationId);
    expect(row?.last_engine_type).toBe("copilot");
  });
});

// ─── CE-14: model-update condition syncs DB model when model changes ──────────

describe("CE-14: model-update syncs conversations.model when model changes", () => {
  it("updates conversations.model when execute is called with a different model", async () => {
    const { sessionId, conversationId } = seedChatSession(db, { model: "copilot/v1" });
    const { executor } = makeExecutor({});

    await executor.execute(sessionId, conversationId, "hello", "copilot/v2");

    const row = db.query<{ model: string | null }, [number]>(
      "SELECT model FROM conversations WHERE id = ?",
    ).get(conversationId);
    expect(row?.model).toBe("copilot/v2");
  });
});

// ─── CE-15..17: cross-engine context injection ───────────────────────────────

describe("CE-15..17: cross-engine context injection", () => {
  it("CE-15: prior engine turns appear in prompt when engine switches (pi → claude)", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "claude/opus",
      lastEngineType: "pi",
    });
    seedMessage(db, null, conversationId, "assistant", null, "Pi assistant response");

    const injector = new CrossEngineContextInjector(db, makeTestRegistryWith(new Map([
      ["pi", new PassThroughEngine()],
    ])));
    const { executor, streamProcessor } = makeExecutor({ crossEngineInjector: injector });

    await executor.execute(sessionId, conversationId, "new claude question", "claude/opus");

    const prompt = streamProcessor.lastRun?.params.prompt ?? "";
    expect(prompt).toContain("<ASSISTANT>");
    expect(prompt).toContain("Pi assistant response");
  });

  it("CE-16: compaction_summary + pi turns → prompt contains <SUMMARY> and post-compaction turns", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "claude/opus",
      lastEngineType: "pi",
    });
    seedMessage(db, null, conversationId, "compaction_summary", null, "Pi compaction summary");
    seedMessage(db, null, conversationId, "assistant", null, "Pi post-compaction response");

    const injector = new CrossEngineContextInjector(db, makeTestRegistryWith(new Map([
      ["pi", new PassThroughEngine()],
    ])));
    const { executor, streamProcessor } = makeExecutor({ crossEngineInjector: injector });

    await executor.execute(sessionId, conversationId, "question", "claude/opus");

    const prompt = streamProcessor.lastRun?.params.prompt ?? "";
    expect(prompt).toContain("<SUMMARY>");
    expect(prompt).toContain("Pi compaction summary");
    expect(prompt).toContain("Pi post-compaction response");
  });

  it("CE-17: current user message is NOT included inside <message_history> block", async () => {
    const { sessionId, conversationId } = seedChatSession(db, {
      model: "claude/opus",
      lastEngineType: "copilot",
    });
    seedMessage(db, null, conversationId, "assistant", null, "Copilot prior response");

    const injector = new CrossEngineContextInjector(db, makeTestRegistryWith(new Map([
      ["copilot", new PassThroughEngine()],
    ])));
    const { executor, streamProcessor } = makeExecutor({ crossEngineInjector: injector });

    await executor.execute(sessionId, conversationId, "current user question", "claude/opus");

    const prompt = streamProcessor.lastRun?.params.prompt ?? "";
    const historySection = prompt.includes("<message_history>")
      ? prompt.slice(prompt.indexOf("<message_history>"), prompt.indexOf("</message_history>"))
      : "";
    expect(historySection).not.toContain("current user question");
  });
});

