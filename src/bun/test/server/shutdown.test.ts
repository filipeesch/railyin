import { describe, test, expect } from "bun:test";
import { createShutdownHandler } from "../../server/shutdown.ts";

const makeOpts = () => {
  const calls = { kill: 0, stop: 0, exit: [] as number[] };
  const opts = {
    graceMs: 50,
    killAllPtySessions: () => { calls.kill++; },
    stopAllCodeServers: () => { calls.stop++; },
    exitFn: (code: number) => { calls.exit.push(code); return undefined as never; },
  };
  return { opts, calls };
};

const makeOrchestrator = () => {
  const shutdownCalls: object[] = [];
  return {
    orchestrator: {
      shutdownNonNativeEngines: async (params: object) => { shutdownCalls.push(params); },
      markClaudeExecution: () => {},
    } as any,
    shutdownCalls,
  };
};

describe("shutdown", () => {
  test("SD-1 — shutdown() is idempotent", async () => {
    const { opts, calls } = makeOpts();
    const { orchestrator } = makeOrchestrator();
    const { shutdown } = createShutdownHandler(orchestrator, opts);

    await shutdown();
    await shutdown();

    expect(calls.kill).toBe(1);
  });

  test("SD-2 — shutdown() invokes orchestrator.shutdownNonNativeEngines", async () => {
    const { opts } = makeOpts();
    const { orchestrator, shutdownCalls } = makeOrchestrator();
    const { shutdown } = createShutdownHandler(orchestrator, opts);

    await shutdown();

    expect(shutdownCalls).toEqual([{ reason: "app-exit", deadlineMs: 50 }]);
  });

  test("SD-3 — shutdown() calls killAllPtySessions then stopAllCodeServers", async () => {
    const { opts, calls } = makeOpts();
    const { orchestrator } = makeOrchestrator();
    const { shutdown } = createShutdownHandler(orchestrator, opts);

    await shutdown();

    expect(calls.kill).toBe(1);
    expect(calls.stop).toBe(1);
  });

  test("SD-4 — shutdown() with null orchestrator completes without throwing", async () => {
    const { opts, calls } = makeOpts();
    const { shutdown } = createShutdownHandler(null, opts);

    await expect(shutdown()).resolves.toBeUndefined();

    expect(calls.kill).toBe(1);
    expect(calls.stop).toBe(1);
  });
});
