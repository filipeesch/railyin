import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { PiEngine } from "../engine/pi/engine.ts";
import type { PiEngineConfig } from "../config/index.ts";
import { NullModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import { BoardRepository } from "../db/board-repository.ts";
import type { Database } from "bun:sqlite";

// ─── MockAgentSession ─────────────────────────────────────────────────────────

interface CompactResult {
  summary?: string;
}

class MockAgentSession {
  compactResult: CompactResult | null = { summary: "Mock compaction summary." };
  compactError: Error | null = null;
  isCompacting = false;

  async compact(): Promise<CompactResult | null> {
    if (this.compactError) throw this.compactError;
    return this.compactResult;
  }

  getContextUsage() {
    return { tokens: 0, contextWindow: 128_000, maxTokens: 128_000, fraction: 0, percent: 0 };
  }

  dispose() {}

  setActiveToolsCallCount = 0;
  lastSetNames: string[] = [];

  async setActiveToolsByName(names: string[]): Promise<void> {
    this.setActiveToolsCallCount++;
    this.lastSetNames = [...names];
  }

  readonly agent = {
    state: {
      model: null as any,
      thinkingLevel: "off" as string,
      systemPrompt: undefined as string | undefined,
    },
    onPayload: undefined as ((payload: unknown, model: unknown) => unknown) | undefined,
  };
}

// ─── TestModelSettingsRepository ─────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePiEngine(session: MockAgentSession): PiEngine {
  const config: PiEngineConfig = { type: "pi" };
  return new PiEngine(
    "test-pi",
    config,
    () => {},
    () => {},
    undefined,
    new StubModelSettingsRepository(128_000),
    new BoardRepository(initDb()),
    async () => session as any,
  );
}

/**
 * Directly exercises the getOrCreateSession reuse path via compact(),
 * which internally calls getOrCreateSession if no live session exists.
 * For reuse tests we need two consecutive calls — we use a helper that
 * accesses the private method via bracket notation.
 */
async function simulateGetOrCreate(engine: PiEngine, conversationId: number, tools: any[], cwd: string): Promise<any> {
  // @ts-expect-error — accessing private method for testing
  return engine.getOrCreateSession(conversationId, {} as any, tools, undefined, cwd);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let db: Database;
let configCleanup: () => void;
let conversationId: number;

beforeEach(() => {
  const cfg = setupTestConfig();
  configCleanup = cfg.cleanup;
  db = initDb();
  const seed = seedProjectAndTask(db, "/test-git");
  conversationId = seed.conversationId;
  // Seed the conversation's model so compact() can resolve it from DB
  db.run("UPDATE conversations SET model = ? WHERE id = ?", ["test-pi/lmstudio/test-model", conversationId]);
});

afterEach(() => {
  configCleanup();
});

describe("PiEngine.compact()", () => {
  it("PE-COMPACT-1: no live session → factory called, session.compact() invoked", async () => {
    let factoryCallCount = 0;
    const session = new MockAgentSession();
    const config: PiEngineConfig = { type: "pi" };
    const engine = new PiEngine(
      "test-pi",
      config,
      () => {},
      () => {},
      undefined,
      new StubModelSettingsRepository(128_000),
      new BoardRepository(initDb()),
      async () => { factoryCallCount++; return session as any; },
    );

    await engine.compact(null, conversationId, "/test-working-dir", "test-workspace");

    expect(factoryCallCount).toBe(1);
  });

  it("PE-COMPACT-2: session.isCompacting = true → throws 'Compaction already in progress'", async () => {
    const session = new MockAgentSession();
    session.isCompacting = true;
    const engine = makePiEngine(session);

    await expect(engine.compact(null, conversationId, "/test-working-dir", "test-workspace")).rejects.toThrow(
      "Compaction already in progress",
    );
  });

  it("PE-COMPACT-3: compact() returns summary → compaction_summary row persisted in DB", async () => {
    const session = new MockAgentSession();
    session.compactResult = { summary: "the summary" };
    const engine = makePiEngine(session);

    await engine.compact(null, conversationId, "/test-working-dir", "test-workspace");

    const row = db.query<{ content: string }, [number]>(
      "SELECT content FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
    ).get(conversationId);
    expect(row).toBeDefined();
    expect(row!.content).toBe("the summary");
  });

  it("PE-COMPACT-4: compact() returns null → no compaction_summary row inserted", async () => {
    const session = new MockAgentSession();
    session.compactResult = null;
    const engine = makePiEngine(session);

    await engine.compact(null, conversationId, "/test-working-dir", "test-workspace");

    const row = db.query<{ content: string }, [number]>(
      "SELECT content FROM conversation_messages WHERE conversation_id = ? AND type = 'compaction_summary' ORDER BY id DESC LIMIT 1",
    ).get(conversationId);
    expect(row).toBeNull();
  });
});

describe("PiEngine session reuse", () => {
  it("PE-SESSION-REUSE-1: second execute on same conversationId calls setActiveToolsByName", async () => {
    const session = new MockAgentSession();
    const engine = makePiEngine(session);

    // First call — creates session via factory
    await simulateGetOrCreate(engine, conversationId, [], "/worktree-a");

    // Second call — reuses session; setActiveToolsByName should be called
    await simulateGetOrCreate(engine, conversationId, [], "/worktree-b");
    expect(session.setActiveToolsCallCount).toBe(1);  // called on reuse
  });

  it("PE-SESSION-REUSE-2: reuse includes SDK built-in tool names", async () => {
    const session = new MockAgentSession();
    const engine = makePiEngine(session);

    await simulateGetOrCreate(engine, conversationId, [], "/worktree-a");
    await simulateGetOrCreate(engine, conversationId, [], "/worktree-b");

    expect(session.lastSetNames).toContain("read");
    expect(session.lastSetNames).toContain("grep");
    expect(session.lastSetNames).toContain("find");
    expect(session.lastSetNames).toContain("ls");
  });
});

// ─── _applyPresetToSession ────────────────────────────────────────────────────

function makePiEngineWithPresets(session: MockAgentSession): PiEngine {
  const config: PiEngineConfig = {
    type: "pi",
    default_sampling_preset: "balanced",
    sampling_presets: {
      balanced: { temperature: 0.8, top_p: 0.95 },
      creative: { temperature: 1.2, top_p: 0.98 },
      precise: { temperature: 0.2, top_p: 0.85 },
    },
  };
  return new PiEngine(
    "test-pi",
    config,
    () => {},
    () => {},
    undefined,
    new StubModelSettingsRepository(128_000),
    new BoardRepository(initDb()),
    async () => session as any,
  );
}

describe("_applyPresetToSession", () => {
  it("PE-PRESET-1: named preset → session.agent.onPayload is a function", () => {
    const session = new MockAgentSession();
    const engine = makePiEngineWithPresets(session);
    (engine as any)._applyPresetToSession(session, "creative");
    expect(typeof session.agent.onPayload).toBe("function");
  });

  it("PE-PRESET-2: creative preset → onPayload merges temperature and top_p, excludes unknown keys", () => {
    const session = new MockAgentSession();
    const engine = makePiEngineWithPresets(session);
    (engine as any)._applyPresetToSession(session, "creative");
    const result = session.agent.onPayload!({ model: "x" }, null) as Record<string, unknown>;
    expect(result.temperature).toBe(1.2);
    expect(result.top_p).toBe(0.98);
    expect(result.model).toBe("x");
    expect("top_k" in result).toBe(false);
    expect("presence_penalty" in result).toBe(false);
  });

  it("PE-PRESET-3: undefined preset on engine with no default → onPayload is undefined", () => {
    const session = new MockAgentSession();
    const engine = makePiEngine(session);
    (engine as any)._applyPresetToSession(session, undefined);
    expect(session.agent.onPayload).toBeUndefined();
  });

  it("PE-PRESET-4: second call overwrites first preset", () => {
    const session = new MockAgentSession();
    const engine = makePiEngineWithPresets(session);
    (engine as any)._applyPresetToSession(session, "creative");
    (engine as any)._applyPresetToSession(session, "precise");
    const result = session.agent.onPayload!({}, null) as Record<string, unknown>;
    expect(result.temperature).toBe(0.2);
  });

  it("PE-PRESET-5: session reuse leakage — applying undefined clears previously set onPayload", () => {
    const session = new MockAgentSession();
    const config: PiEngineConfig = {
      type: "pi",
      sampling_presets: {
        balanced: { temperature: 0.8, top_p: 0.95 },
      },
    };
    const engine = new PiEngine(
      "test-pi",
      config,
      () => {},
      () => {},
      undefined,
      new StubModelSettingsRepository(128_000),
      new BoardRepository(initDb()),
      async () => session as any,
    );
    (engine as any)._applyPresetToSession(session, "balanced");
    (engine as any)._applyPresetToSession(session, undefined);
    expect(session.agent.onPayload).toBeUndefined();
  });
});
