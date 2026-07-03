/**
 * Tests for the background compaction logic inside PiEngine.createManagedExecution.
 *
 * Strategy: inject a MockBgSession that fires turn_end events with configurable
 * context usage. The turn_end handler in createManagedExecution is what triggers
 * or skips background compaction.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PiEngine } from "../../engine/pi/engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionParams } from "../../engine/types.ts";

// ─── MockBgSession ─────────────────────────────────────────────────────────────

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

class MockBgSession {
  compactCallCount = 0;
  continueCallCount = 0;
  compactResult: CompactResult | null = { summary: "bg compaction summary" };
  compactError: Error | null = null;
  isCompacting = false;
  contextUsage: ContextUsage = {
    tokens: 0,
    contextWindow: 128_000,
    maxTokens: 128_000,
    fraction: 0,
    percent: 0,
  };
  /** If set, agent.continue() uses this context usage for its turn_end event. */
  continueContextUsage: ContextUsage | null = null;
  /** Number of turn_end events to fire per prompt() call. */
  turnEndCount = 1;

  private callback: ((event: any) => void) | null = null;

  readonly agent = {
    state: {
      model: null as any,
      thinkingLevel: "off" as string,
      systemPrompt: undefined as string | undefined,
      messages: [] as any[],
    },
    onPayload: undefined as any,
    beforeToolCall: undefined as any,
    continue: async (): Promise<void> => {
      this.continueCallCount++;
      // Optionally fire a turn_end with a per-continue context usage override (for BC-7).
      if (this.continueContextUsage) {
        const prev = this.contextUsage;
        this.contextUsage = this.continueContextUsage;
        this.callback?.({ type: "turn_end" });
        this.contextUsage = prev;
      }
      // Add an assistant message so the resume loop's post-bgCompaction break condition fires.
      this.agent.state.messages.push({ role: "assistant", stopReason: "stop", usage: { input: 100, output: 50, cacheRead: 0 }, content: [] });
      this.callback?.({ type: "agent_end" });
    },
  };

  setActiveToolsCallCount = 0;
  lastSetNames: string[] = [];

  async setActiveToolsByName(names: string[]): Promise<void> {
    this.setActiveToolsCallCount++;
    this.lastSetNames = [...names];
  }

  subscribe(cb: (event: any) => void): () => void {
    this.callback = cb;
    return () => { this.callback = null; };
  }

  async prompt(_text: string): Promise<void> {
    for (let i = 0; i < this.turnEndCount; i++) {
      this.callback?.({ type: "turn_end" });
    }
  }

  async compact(): Promise<CompactResult | null> {
    this.compactCallCount++;
    if (this.compactError) throw this.compactError;
    // Delay one macrotask so the bgCompactions map entry is visible to the resume loop
    // before the finally block deletes it. In production, session.compact() takes real
    // time (LLM call), so the map entry is always observable when the prompt loop checks.
    await new Promise<void>((r) => setTimeout(r, 0));
    return this.compactResult;
  }

  getContextUsage(): ContextUsage {
    return this.contextUsage;
  }

  abort(): Promise<void> { return Promise.resolve(); }
  dispose(): void {}
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

/** Build a PiEngine with the given config and a session factory returning mock. */
function makePiEngine(session: MockBgSession, config: PiEngineConfig): PiEngine {
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

/** Flush pending microtasks/macrotasks so background promises can settle. */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("PiEngine background compaction", () => {
  test("BC-1: tokens below soft threshold — no compaction triggered", async () => {
    // soft threshold = 128_000 - (16384 + 8192) = 103_424
    // tokens = 1000 < 103_424 → no compaction
    const session = new MockBgSession();
    session.contextUsage = { tokens: 1_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.008, percent: 0.8 };

    const config: PiEngineConfig = { type: "pi" };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(0);
  });

  test("BC-2: tokens above soft threshold — compact() called once", async () => {
    // tokens = 110_000 > 103_424 → compaction triggered
    const session = new MockBgSession();
    session.contextUsage = { tokens: 110_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.86, percent: 86 };

    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 } },
    };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(1);
  });

  test("BC-3: double-trigger prevention — two turn_end events in same execution → compact() called only once", async () => {
    const session = new MockBgSession();
    session.contextUsage = { tokens: 110_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.86, percent: 86 };
    session.turnEndCount = 2; // fires two turn_end events per prompt

    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 } },
    };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(1);
  });

  test("BC-4: tryAcquire returns null (limiter saturated) — compaction skipped", async () => {
    // With max_inflight: 1, runWithLimiter holds the single slot for the prompt.
    // When turn_end fires inside prompt(), tryAcquire returns null.
    const session = new MockBgSession();
    session.contextUsage = { tokens: 110_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.86, percent: 86 };

    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 1 } },
    };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    // The slot was held by runWithLimiter during prompt(), so tryAcquire returned null.
    expect(session.compactCallCount).toBe(0);
  });

  test("BC-5: compact() result.summary is persisted as compaction_summary message", async () => {
    const session = new MockBgSession();
    session.contextUsage = { tokens: 110_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.86, percent: 86 };
    session.compactResult = { summary: "the background summary" };

    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 } },
    };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(1);

    const row = db.query<{ content: string }, [number]>(
      "SELECT content FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
    ).get(conversationId);

    expect(row).toBeDefined();
    expect(row!.content).toBe("the background summary");
  });

  test("BC-6: BG compaction fires mid-execution → queue stays open until agent.continue() completes", async () => {
    // Verify the fix: execution must not terminate prematurely (before agent.continue() runs).
    // soft threshold = 128_000 - (16384 + 8192) = 103_424; tokens = 110_000 > 103_424
    const session = new MockBgSession();
    session.contextUsage = { tokens: 110_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.86, percent: 86 };

    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 } },
    };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    // With the fix, the loop calls agent.continue() after the bg compact finishes.
    // Without the fix, queue.close() would have been called before agent.continue().
    expect(session.compactCallCount).toBe(1);
    expect(session.continueCallCount).toBe(1);
  });

  test("BC-7: second turn_end below threshold after BG compact → no second compaction", async () => {
    // After BG compact + agent.continue(), the continue() fires a second turn_end
    // with low token count → must not trigger a second compact.
    const session = new MockBgSession();
    session.contextUsage = { tokens: 110_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.86, percent: 86 };
    // continue() fires turn_end with this low usage: 1_000 tokens < 103_424 threshold
    session.continueContextUsage = { tokens: 1_000, contextWindow: 128_000, maxTokens: 128_000, fraction: 0.008, percent: 0.8 };

    const config: PiEngineConfig = {
      type: "pi",
      providers: { lmstudio: { base_url: "http://localhost:1234/v1", max_inflight: 8 } },
    };
    const engine = makePiEngine(session, config);

    await runExecution(engine, conversationId);
    await flushAsync();

    expect(session.compactCallCount).toBe(1);  // only the first turn_end triggered compact
    expect(session.continueCallCount).toBe(1);  // continue was called once
  });
});
