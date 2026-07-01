/**
 * Tests for the compaction-resume loop inside PiEngine.runWithCompactionResume.
 *
 * Verifies that after background compaction aborts a mid-turn prompt, the engine
 * calls agent.continue() to resume; that a cleanly-finished assistant turn breaks
 * the loop; that SDK overflow willRetry is handled by waitForNextAgentEnd; and
 * that agent.continue() goes through runWithLimiter (the provider concurrency limiter).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PiEngine } from "../../engine/pi/engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import { ProviderLimiterRegistry } from "../../engine/pi/provider-limiter.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionParams, EngineEvent } from "../../engine/types.ts";

// ─── Shared interfaces ────────────────────────────────────────────────────────

interface ContextUsage {
  tokens: number;
  contextWindow: number;
  maxTokens: number;
  fraction: number;
  percent: number;
}

interface CompactResult {
  summary?: string;
}

// ─── MockResumingSession ──────────────────────────────────────────────────────

class MockResumingSession {
  compactCallCount = 0;
  continueCallCount = 0;
  compactResult: CompactResult | null = { summary: "bg compaction summary" };
  compactError: Error | null = null;
  continueError: Error | null = null;
  contextUsage: ContextUsage = {
    tokens: 110_000,
    contextWindow: 128_000,
    maxTokens: 128_000,
    fraction: 0.86,
    percent: 86,
  };
  /** When true, prompt() fires turn_end but does NOT append an assistant message. */
  abortMidTurn = false;
  /** When true, prompt() emits compaction_end { willRetry: true } + fires agent_end asynchronously. */
  emitSdkWillRetry = false;
  /** When true, prompt() emits compaction_end { willRetry: false }. */
  emitSdkNoRetry = false;

  private subscribers: Array<(event: any) => void> = [];

  readonly agent = {
    state: {
      model: null as any,
      thinkingLevel: "off" as string,
      systemPrompt: undefined as string | undefined,
      messages: [{ role: "user", content: "test" }] as any[],
    },
    onPayload: undefined as any,
    beforeToolCall: undefined as any,
    continue: async (): Promise<void> => {
      this.continueCallCount++;
      if (this.continueError) throw this.continueError;
      this.emit({ type: "agent_end" });
    },
  };

  subscribe(cb: (event: any) => void): () => void {
    this.subscribers.push(cb);
    return () => {
      const idx = this.subscribers.indexOf(cb);
      if (idx !== -1) this.subscribers.splice(idx, 1);
    };
  }

  emit(event: any): void {
    for (const cb of [...this.subscribers]) {
      cb(event);
    }
  }

  async prompt(_text: string): Promise<void> {
    this.emit({ type: "turn_end" });
    if (!this.abortMidTurn) {
      this.agent.state.messages.push({
        role: "assistant",
        stopReason: "stop",
        usage: { input: 100, output: 50, cacheRead: 0 },
        content: [],
      });
    }
    if (this.emitSdkWillRetry) {
      this.emit({ type: "compaction_end", aborted: false, willRetry: true, reason: "overflow", result: undefined });
      // Simulate the SDK's deferred agent.continue() completing via setTimeout.
      // waitForNextAgentEnd() subscribes AFTER this prompt() resolves, so the
      // setTimeout ensures agent_end fires after the subscription is established.
      setTimeout(() => {
        this.emit({ type: "agent_end" });
      }, 10);
    }
    if (this.emitSdkNoRetry) {
      this.emit({ type: "compaction_end", aborted: false, willRetry: false, reason: "overflow", result: undefined });
    }
  }

  async compact(): Promise<CompactResult | null> {
    this.compactCallCount++;
    if (this.compactError) throw this.compactError;
    // Delay via macrotask so bgCompactions is still in the map when
    // runWithCompactionResume checks it after await runWithLimiter().
    await new Promise((resolve) => setTimeout(resolve, 0));
    return this.compactResult;
  }

  getContextUsage(): ContextUsage {
    return this.contextUsage;
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {}

  async setActiveToolsByName(_names: string[]): Promise<void> {}
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

class StubModelSettingsRepository extends NullModelSettingsRepository {
  private readonly contextWindow: number;
  constructor(contextWindow: number) {
    super();
    this.contextWindow = contextWindow;
  }
  override getContextWindow(_workspaceKey: string, _qualifiedModelId: string): number | null {
    return this.contextWindow;
  }
}

class SpyProviderLimiterRegistry extends ProviderLimiterRegistry {
  acquireCallCount = 0;
  override acquire(providerName: string, signal?: AbortSignal) {
    this.acquireCallCount++;
    return super.acquire(providerName, signal);
  }
}

function makePiEngine(session: MockResumingSession, config: PiEngineConfig): PiEngine {
  return new PiEngine(
    "test-pi",
    config,
    () => {},
    () => {},
    undefined,
    new StubModelSettingsRepository(128_000),
    async () => session as any,
  );
}

function makePiEngineWithRegistry(
  session: MockResumingSession,
  config: PiEngineConfig,
  registry: ProviderLimiterRegistry,
): PiEngine {
  return new PiEngine(
    "test-pi",
    config,
    () => {},
    () => {},
    undefined,
    new StubModelSettingsRepository(128_000),
    async () => session as any,
    registry,
  );
}

async function runExecution(engine: PiEngine, convId: number): Promise<void> {
  const ac = new AbortController();
  const params: ExecutionParams = {
    executionId: 1,
    taskId: null,
    conversationId: convId,
    boardId: undefined,
    prompt: "test prompt",
    workingDirectory: "/test-cwd",
    model: "test-pi/lmstudio/test-model",
    signal: ac.signal,
    contextWindowOverride: 128_000,
  } as ExecutionParams;

  for await (const _ of engine.execute(params)) {
    // consume events
  }
}

async function collectEvents(engine: PiEngine, convId: number): Promise<EngineEvent[]> {
  const ac = new AbortController();
  const params: ExecutionParams = {
    executionId: 1,
    taskId: null,
    conversationId: convId,
    boardId: undefined,
    prompt: "test prompt",
    workingDirectory: "/test-cwd",
    model: "test-pi/lmstudio/test-model",
    signal: ac.signal,
    contextWindowOverride: 128_000,
  } as ExecutionParams;

  const events: EngineEvent[] = [];
  for await (const event of engine.execute(params)) {
    events.push(event);
  }
  return events;
}

async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

// ─── Test config ──────────────────────────────────────────────────────────────

const baseConfig: PiEngineConfig = {
  type: "pi",
  providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 } },
};

// ─── Test state ───────────────────────────────────────────────────────────────

let db: Database;
let configCleanup: () => void;
let conversationId: number;

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test-git");
  conversationId = seed.conversationId;
  db.run("UPDATE conversations SET model = ? WHERE id = ?", ["test-pi/lmstudio/test-model", conversationId]);
});

afterEach(() => {
  configCleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PiEngine compaction resume", () => {
  test("CR-1: BG compaction fires mid-turn → queue stays open → agent.continue() called", async () => {
    // soft threshold = 128_000 - (16384 + 8192) = 103_424
    // tokens = 110_000 > 103_424 → BG compact triggered
    // abortMidTurn=true → no assistant message added → last message is user → engine calls continue()
    const session = new MockResumingSession();
    session.abortMidTurn = true;

    const engine = makePiEngine(session, baseConfig);
    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(1);
    expect(session.continueCallCount).toBe(1);
  });

  test("CR-2: Last message is assistant after BG compaction → agent.continue() NOT called", async () => {
    // abortMidTurn=false → prompt() appends assistant message
    // BG compact fires on turn_end → awaited → last message role === "assistant" → break
    const session = new MockResumingSession();
    session.abortMidTurn = false;

    const engine = makePiEngine(session, baseConfig);
    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(1);
    expect(session.continueCallCount).toBe(0);
  });

  test("CR-3: Two sequential executions each trigger compact + continue", async () => {
    // bgCompactions is cleared after each compact, so the second execution starts fresh.
    // Both executions: abortMidTurn=true → compact + continue each time.
    const session = new MockResumingSession();
    session.abortMidTurn = true;

    const engine = makePiEngine(session, baseConfig);
    await runExecution(engine, conversationId);
    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(2);
    expect(session.continueCallCount).toBe(2);
  });

  test("CR-4: agent.continue() throws → error event yielded by engine", async () => {
    const session = new MockResumingSession();
    session.abortMidTurn = true;
    session.continueError = new Error("continue failed");

    const engine = makePiEngine(session, baseConfig);
    const events = await collectEvents(engine, conversationId);

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  test("CR-5: agent.continue() goes through runWithLimiter (spy registry)", async () => {
    // runWithLimiter calls registry.acquire() — once for prompt(), once for agent.continue().
    // Background compaction uses tryAcquire() (separate path, not counted by spy).
    const session = new MockResumingSession();
    session.abortMidTurn = true;

    const spy = new SpyProviderLimiterRegistry();
    const engine = makePiEngineWithRegistry(session, baseConfig, spy);
    await runExecution(engine, conversationId);

    expect(spy.acquireCallCount).toBe(2);
  });

  test("CR-6: SDK overflow willRetry=true → engine waits for agent_end via waitForNextAgentEnd", async () => {
    // tokens below soft threshold → no BG compact triggered
    // compaction_end { willRetry: true } → engine sets sdkWillRetryRef and awaits agent_end
    // agent_end fires via setTimeout (simulating SDK's internal deferred continue)
    // Engine then calls agent.continue() on the next loop iteration
    const session = new MockResumingSession();
    session.abortMidTurn = true;
    session.emitSdkWillRetry = true;
    session.contextUsage = {
      tokens: 1_000,
      contextWindow: 128_000,
      maxTokens: 128_000,
      fraction: 0.008,
      percent: 0.8,
    };

    const engine = makePiEngine(session, baseConfig);
    await runExecution(engine, conversationId);
    await flushAsync();

    // No BG compact — tokens were below threshold
    expect(session.compactCallCount).toBe(0);
    // agent.continue() called once — on the loop iteration following waitForNextAgentEnd
    expect(session.continueCallCount).toBe(1);
  });

  test("CR-7: compaction_end willRetry=false → not treated as SDK overflow retry", async () => {
    // willRetry=false does NOT set sdkWillRetryRef; execution completes normally without continue()
    const session = new MockResumingSession();
    session.abortMidTurn = false;
    session.emitSdkNoRetry = true;
    session.contextUsage = {
      tokens: 1_000,
      contextWindow: 128_000,
      maxTokens: 128_000,
      fraction: 0.008,
      percent: 0.8,
    };

    const engine = makePiEngine(session, baseConfig);
    await runExecution(engine, conversationId);

    expect(session.compactCallCount).toBe(0);
    expect(session.continueCallCount).toBe(0);
  });
});
