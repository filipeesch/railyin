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
  getOrCreateSessionCallCount = 0;

  constructor(session: MockAgentSession) {
    const config: PiEngineConfig = { type: "pi" };
    super("test-pi", config, () => {}, () => {}, undefined, new StubModelSettingsRepository(128_000));
    this.injectedSession = session;
  }

  protected async getOrCreateSession(
    _conversationId: number,
    _model: any,
    _tools: unknown[],
    _systemPrompt: string | undefined,
    _workingDirectory: string,
  ): Promise<any> {
    this.getOrCreateSessionCallCount++;
    return this.injectedSession;
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

    expect(engine.getOrCreateSessionCallCount).toBe(1);
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
