import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, seedProjectAndTask, setupTestConfig } from "./helpers.ts";
import { PiEngine } from "../engine/pi/engine.ts";
import type { PiEngineConfig } from "../config/index.ts";
import { NullModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
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

// ─── TestPiEngine ─────────────────────────────────────────────────────────────

class TestPiEngine extends PiEngine {
  private readonly injectedSession: MockAgentSession;
  createNewSessionCallCount = 0;

  constructor(session: MockAgentSession) {
    const config: PiEngineConfig = { type: "pi" };
    super("test-pi", config, () => {}, () => {}, undefined, new StubModelSettingsRepository(128_000));
    this.injectedSession = session;
  }

  protected async createNewSession(
    _tools: unknown[],
    _systemPrompt: string | undefined,
    _conversationId: number,
    _model: any,
    _cwd: string,
  ): Promise<any> {
    this.createNewSessionCallCount++;
    return this.injectedSession;
  }

  /** Directly exercises the getOrCreateSession reuse path, bypassing execute()'s full setup. */
  async simulateGetOrCreate(conversationId: number, tools: any[], cwd: string): Promise<any> {
    return this.getOrCreateSession(conversationId, {} as any, tools, undefined, cwd);
  }
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
  it("PE-COMPACT-1: no live session → getOrCreateSession called, session.compact() invoked", async () => {
    const session = new MockAgentSession();
    const engine = new TestPiEngine(session);

    await engine.compact(null, conversationId, "/test-working-dir", "test-workspace");

    expect(engine.createNewSessionCallCount).toBe(1);
  });

  it("PE-COMPACT-2: session.isCompacting = true → throws 'Compaction already in progress'", async () => {
    const session = new MockAgentSession();
    session.isCompacting = true;
    const engine = new TestPiEngine(session);

    await expect(engine.compact(null, conversationId, "/test-working-dir", "test-workspace")).rejects.toThrow(
      "Compaction already in progress",
    );
  });

  it("PE-COMPACT-3: compact() returns summary → compaction_summary row persisted in DB", async () => {
    const session = new MockAgentSession();
    session.compactResult = { summary: "the summary" };
    const engine = new TestPiEngine(session);

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
    const engine = new TestPiEngine(session);

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
    const engine = new TestPiEngine(session);

    // First call — creates session
    await engine.simulateGetOrCreate(conversationId, [], "/worktree-a");
    expect(engine.createNewSessionCallCount).toBe(1);

    // Second call — reuses session; setActiveToolsByName should be called
    await engine.simulateGetOrCreate(conversationId, [], "/worktree-b");
    expect(engine.createNewSessionCallCount).toBe(1); // no new session created
    expect(session.setActiveToolsCallCount).toBe(1);  // called on reuse
  });

  it("PE-SESSION-REUSE-2: reuse includes SDK built-in tool names", async () => {
    const session = new MockAgentSession();
    const engine = new TestPiEngine(session);

    await engine.simulateGetOrCreate(conversationId, [], "/worktree-a");
    await engine.simulateGetOrCreate(conversationId, [], "/worktree-b");

    expect(session.lastSetNames).toContain("read");
    expect(session.lastSetNames).toContain("grep");
    expect(session.lastSetNames).toContain("find");
    expect(session.lastSetNames).toContain("ls");
  });
});
