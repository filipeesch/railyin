/**
 * Regression tests for the Pi engine run-path model-config resolution (task #605).
 *
 * These verify that a provider-bearing qualified model id (e.g. the 3-part
 * `pi-local/vllm/deepseek-v4-flash` or the 4-part
 * `pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731`) resolves its
 * per-model config through the engine run path, so that a Mode=max selection
 * yields a reasoning-enabled `thinkingLevel` instead of defaulting to "off".
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PiEngine } from "../../engine/pi/engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { initDb, seedProjectAndTask, setupTestConfig } from "../helpers.ts";
import { NullModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { Database } from "bun:sqlite";
import type { ExecutionParams } from "../../engine/types.ts";

// ─── Minimal mock session (mirrors loop-detection-engine.test.ts) ────────────

class MockReasoningSession {
  /** Captures the agent state AFTER prompt() runs, so tests can assert thinkingLevel. */
  readonly agent: {
    state: {
      model: any;
      thinkingLevel: string;
      systemPrompt: string | undefined;
      messages: any[];
    };
    onPayload: ((payload: unknown) => unknown) | undefined;
    waitForIdle: () => Promise<void>;
    beforeToolCall?: (ctx: any) => Promise<any>;
  } = {
    state: {
      model: null as any,
      thinkingLevel: "off" as string,
      systemPrompt: undefined as string | undefined,
      messages: [] as any[],
    },
    onPayload: undefined as any,
    waitForIdle: async (): Promise<void> => {},
  };

  /**
   * Invoke the applier-installed `onPayload` against a base request body and return the
   * merged result, so tests can assert the wire body (thinking/ reasoning_effort) directly.
   */
  mergedBody(base: Record<string, unknown> = { model: "deepseek-v4-flash", messages: [], stream: true }) {
    const fn = this.agent.onPayload;
    if (!fn) return base;
    const out = fn(base);
    return (typeof out === "object" && out !== null ? out : {}) as Record<string, unknown>;
  }

  subscribe(cb: (event: any) => void): () => void {
    void cb;
    return () => {};
  }

  async setActiveToolsByName(_names: string[]): Promise<void> {}

  async prompt(_text: string): Promise<void> {}

  getContextUsage() {
    return { tokens: 0, contextWindow: 128_000, maxTokens: 128_000, fraction: 0, percent: 0 };
  }

  async compact() { return null; }
  abort(): Promise<void> { return Promise.resolve(); }
  dispose(): void {}
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

const DEEPSEEK_LOCAL_CONFIG: PiEngineConfig = {
  type: "pi",
  providers: {
    vllm: { base_url: "https://vllm.esch.pt/v1/" },
  },
  models: {
    "deepseek-v4-flash": {
      name: "DeepSeek V4 Flash",
      reasoning: true,
      thinkingFormat: "deepseek",
      variants: {
        none: { label: "Off", thinking: false, options: { reasoning_effort: "none" } },
        normal: { label: "Normal", thinking: true, options: { reasoning_effort: "high" } },
        max: { label: "Max", thinking: true, options: { reasoning_effort: "max" } },
      },
    },
  },
};

const DEEPSEEK_OPENROUTER_CONFIG: PiEngineConfig = {
  type: "pi",
  providers: {
    openrouter: { base_url: "https://openrouter.ai/api/v1" },
  },
  models: {
    "deepseek/deepseek-v4-flash-0731": {
      name: "DeepSeek V4 Flash",
      reasoning: true,
      thinkingFormat: "openrouter",
      variants: {
        none: { label: "Off", thinking: false, options: { reasoning_effort: "none" } },
        max: { label: "Max", thinking: true, options: { reasoning_effort: "max" } },
      },
    },
  },
};

function makePiEngine(session: MockReasoningSession, config: PiEngineConfig): PiEngine {
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

async function runExecution(
  engine: PiEngine,
  convId: number,
  model: string,
  execId = 1,
  modelParams?: Array<{ id: string; value: string }>,
): Promise<void> {
  const ac = new AbortController();
  const params: ExecutionParams = {
    executionId: execId,
    taskId: null,
    conversationId: convId,
    boardId: undefined,
    prompt: "test prompt",
    workingDirectory: "/test-cwd",
    model,
    signal: ac.signal,
    contextWindowOverride: 128_000,
    ...(modelParams ? { modelParams } : {}),
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
});

afterEach(() => {
  configCleanup();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("PiEngine model-config resolution (run path)", () => {
  test("RE-1: 3-part pi-local id with mode=max injects thinking enabled + reasoning_effort max", async () => {
    const session = new MockReasoningSession();
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["pi-local/vllm/deepseek-v4-flash", conversationId]);

    const engine = makePiEngine(session, DEEPSEEK_LOCAL_CONFIG);
    await runExecution(engine, conversationId, "pi-local/vllm/deepseek-v4-flash", 100, [
      { id: "mode", value: "max" },
    ]);

    const body = session.mergedBody();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
  });

  test("RE-2: 4-part pi-openrouter id with mode=max injects thinking enabled + reasoning_effort max", async () => {
    const session = new MockReasoningSession();
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731", conversationId]);

    const engine = makePiEngine(session, DEEPSEEK_OPENROUTER_CONFIG);
    await runExecution(engine, conversationId, "pi-openrouter/openrouter/deepseek/deepseek-v4-flash-0731", 101, [
      { id: "mode", value: "max" },
    ]);

    const body = session.mergedBody();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
  });

  test("RE-3: mode=normal injects thinking enabled + reasoning_effort high", async () => {
    const session = new MockReasoningSession();
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["pi-local/vllm/deepseek-v4-flash", conversationId]);

    const engine = makePiEngine(session, DEEPSEEK_LOCAL_CONFIG);
    await runExecution(engine, conversationId, "pi-local/vllm/deepseek-v4-flash", 102, [
      { id: "mode", value: "normal" },
    ]);

    const body = session.mergedBody();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });

  test("RE-4: mode=none injects thinking disabled + reasoning_effort none", async () => {
    const session = new MockReasoningSession();
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["pi-local/vllm/deepseek-v4-flash", conversationId]);

    const engine = makePiEngine(session, DEEPSEEK_LOCAL_CONFIG);
    await runExecution(engine, conversationId, "pi-local/vllm/deepseek-v4-flash", 103, [
      { id: "mode", value: "none" },
    ]);

    const body = session.mergedBody();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBe("none");
  });

  test("RE-5: genuinely absent config key yields defaults, no crash", async () => {
    const session = new MockReasoningSession();
    const config: PiEngineConfig = {
      type: "pi",
      models: { "other-model": { } },
    };
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["pi-local/vllm/not-configured", conversationId]);

    const engine = makePiEngine(session, config);
    await runExecution(engine, conversationId, "pi-local/vllm/not-configured", 104, [
      { id: "mode", value: "max" },
    ]);

    // No matching config key → onPayload remains unset (no crash); thinkingLevel defaults off.
    expect(session.agent.onPayload).toBeUndefined();
    expect(session.agent.state.thinkingLevel).toBe("off");
  });

  test("RE-6: boolean-only reasoning model injects enable_thinking verbatim", async () => {
    const session = new MockReasoningSession();
    const config: PiEngineConfig = {
      type: "pi",
      models: {
        "deepseek-v4-flash": {
          name: "Boolean Reasoning",
          reasoning: true,
          thinkingFormat: "deepseek",
          variants: {
            none: { label: "Off", thinking: false, options: {} },
            high: { label: "High", thinking: true, options: { enable_thinking: true } },
          },
        },
      },
    };
    db.run("UPDATE conversations SET model = ? WHERE id = ?", ["pi-local/vllm/deepseek-v4-flash", conversationId]);

    const engine = makePiEngine(session, config);
    await runExecution(engine, conversationId, "pi-local/vllm/deepseek-v4-flash", 105, [
      { id: "mode", value: "high" },
    ]);

    const body = session.mergedBody();
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.enable_thinking).toBe(true);
  });
});
