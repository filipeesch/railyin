/**
 * Integration tests for loop detection wired into PiEngine.createManagedExecution.
 *
 * Strategy: inject a MockLoopSession whose prompt() fires tool calls through
 * session.agent.beforeToolCall, so we can verify that the engine wires the
 * detector correctly and that it resets per execution.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PiEngine } from "../../engine/pi/engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionParams } from "../../engine/types.ts";

// ─── MockLoopSession ──────────────────────────────────────────────────────────

interface SimulatedToolCall {
  name: string;
  args: Record<string, unknown>;
}

class MockLoopSession {
  /** Sequence of tool calls to simulate when prompt() is called. */
  toolCallSequence: SimulatedToolCall[] = [];
  /** Which calls were blocked by beforeToolCall. */
  blockedCalls: string[] = [];

  private callback: ((event: any) => void) | null = null;

  readonly agent: {
    state: {
      model: any;
      thinkingLevel: string;
      systemPrompt: string | undefined;
      messages: any[];
    };
    onPayload: any;
    beforeToolCall: ((ctx: any) => Promise<any>) | undefined;
    waitForIdle: () => Promise<void>;
  } = {
    state: {
      model: null as any,
      thinkingLevel: "off" as string,
      systemPrompt: undefined as string | undefined,
      messages: [] as any[],
    },
    onPayload: undefined as any,
    beforeToolCall: undefined as any,
    waitForIdle: async (): Promise<void> => {},
  };

  subscribe(cb: (event: any) => void): () => void {
    this.callback = cb;
    return () => { this.callback = null; };
  }

  async setActiveToolsByName(_names: string[]): Promise<void> {}

  async prompt(_text: string): Promise<void> {
    for (const call of this.toolCallSequence) {
      if (this.agent.beforeToolCall) {
        const result = await this.agent.beforeToolCall({
          toolCall: { name: call.name },
          args: call.args,
          assistantMessage: {},
          context: {},
        });
        if (result?.block) {
          this.blockedCalls.push(call.name);
        }
      }
    }
    this.callback?.({ type: "turn_end" });
  }

  getContextUsage() {
    return { tokens: 0, contextWindow: 128_000, maxTokens: 128_000, fraction: 0, percent: 0 };
  }

  async compact() { return null; }
  abort(): Promise<void> { return Promise.resolve(); }
  dispose(): void {}
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePiEngine(session: MockLoopSession, config: PiEngineConfig = { type: "pi" }): PiEngine {
  return new PiEngine(
    "test-pi",
    config,
    () => {},
    () => {},
    undefined,
    new NullModelSettingsRepository(),
    async () => session as any,
  );
}

async function runExecution(engine: PiEngine, convId: number, execId = 1): Promise<void> {
  const ac = new AbortController();
  const params: ExecutionParams = {
    executionId: execId,
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

// ─── Test state ────────────────────────────────────────────────────────────────

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

describe("PiEngine loop detection (integration)", () => {
  test("LDE-1: beforeToolCall is wired — identical calls trigger block after 3 repeats", async () => {
    const session = new MockLoopSession();
    session.toolCallSequence = [
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } }, // 3rd — triggers block
      { name: "read", args: { path: "/a.ts" } }, // 4th — also blocked (still over threshold)
    ];

    const engine = makePiEngine(session);
    await runExecution(engine, conversationId);

    expect(session.blockedCalls.length).toBeGreaterThanOrEqual(1);
    expect(session.blockedCalls[0]).toBe("read");
  });

  test("LDE-2: detector resets between executions on the same conversation", async () => {
    const session = new MockLoopSession();
    const engine = makePiEngine(session);

    // First execution: 2 identical calls (no block)
    session.toolCallSequence = [
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } },
    ];
    await runExecution(engine, conversationId, 1);
    expect(session.blockedCalls).toHaveLength(0);

    // Reset tracked blocked calls for the second execution
    session.blockedCalls = [];

    // Second execution: same 2 calls — still no block (detector was reset)
    session.toolCallSequence = [
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } },
    ];
    await runExecution(engine, conversationId, 2);
    expect(session.blockedCalls).toHaveLength(0);
  });

  test("LDE-3: ABAB pattern triggers when A or B reaches 3 within the window", async () => {
    const session = new MockLoopSession();
    session.toolCallSequence = [
      { name: "toolA", args: { x: 1 } },
      { name: "toolB", args: { x: 1 } },
      { name: "toolA", args: { x: 1 } },
      { name: "toolB", args: { x: 1 } },
      { name: "toolA", args: { x: 1 } }, // toolA now at 3 — triggers block
    ];

    const engine = makePiEngine(session);
    await runExecution(engine, conversationId);

    expect(session.blockedCalls).toContain("toolA");
  });

  test("LDE-4: two distinct conversations have independent detectors", async () => {
    const seed2 = seedProjectAndTask(db, "/test-git-2");
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["test-pi/lmstudio/test-model", seed2.conversationId]);

    const session1 = new MockLoopSession();
    const session2 = new MockLoopSession();

    // First conversation: 2 calls (not yet blocked)
    session1.toolCallSequence = [
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } },
    ];

    // Second conversation: 3 calls (should be blocked independently)
    session2.toolCallSequence = [
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } },
      { name: "read", args: { path: "/a.ts" } },
    ];

    const engine1 = makePiEngine(session1);
    const engine2 = makePiEngine(session2);

    await runExecution(engine1, conversationId);
    await runExecution(engine2, seed2.conversationId);

    expect(session1.blockedCalls).toHaveLength(0);
    expect(session2.blockedCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("LDE-5: diverse tool calls with unique args do not trigger false positives", async () => {
    const session = new MockLoopSession();
    session.toolCallSequence = Array.from({ length: 15 }, (_, i) => ({
      name: "read",
      args: { path: `/file-${i}.ts` },
    }));

    const engine = makePiEngine(session);
    await runExecution(engine, conversationId);

    expect(session.blockedCalls).toHaveLength(0);
  });
});
