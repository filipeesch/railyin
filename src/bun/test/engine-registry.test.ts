import { describe, it, expect } from "vitest";
import { EngineRegistry } from "../engine/engine-registry.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, EngineShutdownOptions } from "../engine/types.ts";

function makeEngine(overrides: Partial<ExecutionEngine> = {}): ExecutionEngine & { cancelCalls: number[]; shutdownCalled: boolean } {
  const obj = {
    cancelCalls: [] as number[],
    shutdownCalled: false,
    async *execute(_params: ExecutionParams): AsyncIterable<EngineEvent> { yield { type: "done" }; },
    async resume(_id: number, _input: EngineResumeInput): Promise<void> {},
    cancel(executionId: number): void { obj.cancelCalls.push(executionId); },
    async shutdown(_options?: EngineShutdownOptions): Promise<void> { obj.shutdownCalled = true; },
    async listModels() { return []; },
    async listCommands() { return []; },
    ...overrides,
  };
  return obj;
}

describe("EngineRegistry.getEngine", () => {
  it("calls the factory once and caches the result", () => {
    let calls = 0;
    const engine = makeEngine();
    const registry = new EngineRegistry(() => { calls++; return engine; });

    const a = registry.getEngine("ws-1");
    const b = registry.getEngine("ws-1");

    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("calls the factory separately for distinct keys", () => {
    let calls = 0;
    const registry = new EngineRegistry(() => { calls++; return makeEngine(); });

    const a = registry.getEngine("ws-a");
    const b = registry.getEngine("ws-b");

    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });
});

describe("EngineRegistry.cancelAll", () => {
  it("calls cancel on a cached engine", () => {
    const engine = makeEngine();
    const registry = new EngineRegistry(() => engine);
    registry.getEngine("ws-1");

    registry.cancelAll(99);

    expect(engine.cancelCalls).toContain(99);
  });

  it("is a no-op when no engine has been cached yet", () => {
    const registry = new EngineRegistry(() => makeEngine());

    expect(() => registry.cancelAll(1)).not.toThrow();
  });
});

describe("EngineRegistry.fromFixed", () => {
  it("always returns the same injected engine regardless of key", () => {
    const engine = makeEngine();
    const registry = EngineRegistry.fromFixed(engine);

    expect(registry.getEngine("any-key")).toBe(engine);
    expect(registry.getEngine("another-key")).toBe(engine);
  });
});

describe("EngineRegistry.shutdown", () => {
  it("calls shutdown on each cached engine that supports it", async () => {
    const engine = makeEngine();
    const registry = new EngineRegistry(() => engine);
    registry.getEngine("ws-1");

    await registry.shutdown();

    expect(engine.shutdownCalled).toBe(true);
  });

  it("does not throw when engine has no shutdown method", async () => {
    const noShutdown: ExecutionEngine = {
      async *execute(_p: ExecutionParams): AsyncIterable<EngineEvent> { yield { type: "done" }; },
      async resume(_id: number, _input: EngineResumeInput): Promise<void> {},
      cancel(_id: number): void {},
      async listModels() { return []; },
      async listCommands() { return []; },
    };
    const registry = new EngineRegistry(() => noShutdown);
    registry.getEngine("ws-1");

    await expect(registry.shutdown()).resolves.toBeUndefined();
  });
});
