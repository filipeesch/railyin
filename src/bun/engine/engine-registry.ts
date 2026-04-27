import type { ExecutionEngine, EngineShutdownOptions } from "./types.ts";

/**
 * Lazy per-workspace engine cache.
 *
 * The factory is invoked at most once per workspace key; subsequent calls
 * return the cached instance.  Tests wire a fixed engine via `EngineRegistry.fromFixed(engine)`.
 */
export class EngineRegistry {
  private readonly engines = new Map<string, ExecutionEngine>();

  constructor(
    private readonly factory: (workspaceKey: string) => ExecutionEngine,
    preregistered?: ExecutionEngine,
  ) {
    if (preregistered) {
      this.engines.set("__fixed__", preregistered);
    }
  }

  /** Returns (and lazily creates) the engine for the given workspace key. */
  getEngine(workspaceKey: string): ExecutionEngine {
    let engine = this.engines.get(workspaceKey);
    if (!engine) {
      engine = this.factory(workspaceKey);
      this.engines.set(workspaceKey, engine);
    }
    return engine;
  }

  /** Cancels the given executionId on every cached engine instance. */
  cancelAll(executionId: number): void {
    for (const engine of this.engines.values()) {
      engine.cancel(executionId);
    }
  }

  /** Shuts down all cached engine instances gracefully. */
  async shutdown(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    const shutdowns: Array<Promise<void>> = [];
    for (const engine of this.engines.values()) {
      if (!engine.shutdown) continue;
      shutdowns.push(engine.shutdown(options).catch((err) => {
        console.warn("[engine-registry] Shutdown failed", {
          reason: options.reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }));
    }
    await Promise.all(shutdowns);
  }

  /** Convenience constructor for tests: returns a registry that always yields `engine`. */
  static fromFixed(engine: ExecutionEngine): EngineRegistry {
    return new EngineRegistry(() => engine, engine);
  }
}
