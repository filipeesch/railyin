import { describe, it, expect } from "vitest";
import { EngineRegistry } from "../engine/engine-registry.ts";
import { QualifiedModelId } from "../engine/qualified-model-id.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineResumeInput, EngineShutdownOptions } from "../engine/types.ts";
import type { LoadedConfig } from "../config/index.ts";

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

function makeConfig(engineIds: string[], allowedEngineIds?: string[]): LoadedConfig {
  return {
    engine: { type: engineIds[0] ?? "copilot" },
    engines: engineIds.map((id) => ({ id, config: { type: id } })),
    allowedEngineIds: allowedEngineIds ?? null,
    workspace: { name: "test", workspace_path: "/tmp", projects: [] },
    workflows: [],
    workflowsById: new Map(),
    boardsByWorkflow: new Map(),
    chatWorkflows: [],
  } as unknown as LoadedConfig;
}

function makeRegistry(engines: Record<string, ExecutionEngine>, config: LoadedConfig): EngineRegistry {
  return new EngineRegistry(new Map(Object.entries(engines)), () => config);
}

describe("EngineRegistry.getDefaultEngine", () => {
  it("returns the first engine in the engines list", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"]));

    expect(registry.getDefaultEngine("ws-1")).toBe(a);
  });

  it("skips engines not in allowed_engines", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"], ["claude"]));

    expect(registry.getDefaultEngine("ws-1")).toBe(b);
  });

  it("throws when no engines are registered", () => {
    const registry = makeRegistry({}, makeConfig(["copilot"]));
    expect(() => registry.getDefaultEngine("ws-1")).toThrow();
  });
});

describe("EngineRegistry.getEngineForModel", () => {
  it("routes to the correct engine by engineId prefix", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"]));

    const qmid = QualifiedModelId.parse("claude/claude-sonnet-4-5");
    expect(registry.getEngineForModel("ws-1", qmid)).toBe(b);
  });

  it("falls back to default when engine not allowed", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"], ["copilot"]));

    const qmid = QualifiedModelId.parse("claude/claude-sonnet-4-5");
    expect(registry.getEngineForModel("ws-1", qmid)).toBe(a);
  });
});

describe("EngineRegistry.resolveEngineForModel", () => {
  it("routes by valid model string", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"]));

    expect(registry.resolveEngineForModel("ws-1", "claude/claude-sonnet-4-5")).toBe(b);
  });

  it("returns default engine for null model", () => {
    const a = makeEngine();
    const registry = makeRegistry({ copilot: a }, makeConfig(["copilot"]));

    expect(registry.resolveEngineForModel("ws-1", null)).toBe(a);
  });

  it("returns default engine for unparseable model string", () => {
    const a = makeEngine();
    const registry = makeRegistry({ copilot: a }, makeConfig(["copilot"]));

    expect(registry.resolveEngineForModel("ws-1", "legacy-model-no-prefix")).toBe(a);
  });
});

describe("EngineRegistry.listAllEngines", () => {
  it("returns all engines when no filter is set", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"]));

    expect(registry.listAllEngines("ws-1")).toEqual([a, b]);
  });

  it("filters to allowed engines", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"], ["claude"]));

    expect(registry.listAllEngines("ws-1")).toEqual([b]);
  });
});

describe("EngineRegistry.cancelAll", () => {
  it("calls cancel on all registered engines", () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"]));

    registry.cancelAll(99);

    expect(a.cancelCalls).toContain(99);
    expect(b.cancelCalls).toContain(99);
  });

  it("is a no-op when no engines are registered", () => {
    const registry = makeRegistry({}, makeConfig(["copilot"]));
    expect(() => registry.cancelAll(1)).not.toThrow();
  });
});

describe("EngineRegistry.shutdown", () => {
  it("calls shutdown on each engine that supports it", async () => {
    const a = makeEngine();
    const b = makeEngine();
    const registry = makeRegistry({ copilot: a, claude: b }, makeConfig(["copilot", "claude"]));

    await registry.shutdown();

    expect(a.shutdownCalled).toBe(true);
    expect(b.shutdownCalled).toBe(true);
  });

  it("does not throw when an engine has no shutdown method", async () => {
    const noShutdown: ExecutionEngine = {
      async *execute(_p: ExecutionParams): AsyncIterable<EngineEvent> { yield { type: "done" }; },
      async resume(_id: number, _input: EngineResumeInput): Promise<void> {},
      cancel(_id: number): void {},
      async listModels() { return []; },
      async listCommands() { return []; },
    };
    const registry = makeRegistry({ copilot: noShutdown }, makeConfig(["copilot"]));

    await expect(registry.shutdown()).resolves.toBeUndefined();
  });
});

describe("EngineRegistry — additional routing coverage", () => {
  it("ER-2: routes claude/... → claude engine instance", () => {
    const copilotEngine = makeEngine();
    const claudeEngine = makeEngine();
    const registry = makeRegistry({ copilot: copilotEngine, claude: claudeEngine }, makeConfig(["copilot", "claude"]));

    const qmid = QualifiedModelId.parse("claude/claude-sonnet-4-5");
    expect(registry.getEngineForModel("ws-1", qmid)).toBe(claudeEngine);
    expect(registry.getEngineForModel("ws-1", qmid)).not.toBe(copilotEngine);
  });

  it("ER-3: routes opencode/anthropic/... (3-part) → opencode engine instance", () => {
    const copilotEngine = makeEngine();
    const opencodeEngine = makeEngine();
    const registry = makeRegistry(
      { copilot: copilotEngine, opencode: opencodeEngine },
      makeConfig(["copilot", "opencode"]),
    );

    const qmid = QualifiedModelId.parse("opencode/anthropic/claude-sonnet-4-5");
    expect(registry.getEngineForModel("ws-1", qmid)).toBe(opencodeEngine);
  });

  it("ER-10: same engine instance returned for two different workspace keys", () => {
    const engine = makeEngine();
    const registry = makeRegistry({ copilot: engine }, makeConfig(["copilot"]));

    const a = registry.resolveEngineForModel("workspace-a", "copilot/gpt-4.1");
    const b = registry.resolveEngineForModel("workspace-b", "copilot/gpt-4.1");
    expect(a).toBe(b);
  });
});
