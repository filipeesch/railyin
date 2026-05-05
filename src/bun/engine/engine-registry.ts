import type { ExecutionEngine, EngineShutdownOptions } from "./types.ts";
import type { LoadedConfig } from "../config/index.ts";
import { QualifiedModelId } from "./qualified-model-id.ts";

/**
 * Multi-engine registry.
 *
 * Holds a pre-constructed map of `engineId → ExecutionEngine` (one entry per
 * `engines.yaml` entry).  Callers route to the correct engine by passing a
 * `QualifiedModelId`; the registry never instantiates concrete engine classes.
 *
 * DI notes:
 * - Tests inject a fully-constructed `Map<engineId, ExecutionEngine>` via the constructor.
 * - Production code builds the map in `index.ts` (composition root) and passes it here.
 * - The `getWorkspaceConfig` callback is the only workspace-specific dependency.
 */
export class EngineRegistry {
  private readonly engines: Map<string, ExecutionEngine>;

  constructor(
    engines: Map<string, ExecutionEngine>,
    private readonly getWorkspaceConfig: (workspaceKey: string) => LoadedConfig,
  ) {
    this.engines = new Map(engines);
  }

  /**
   * Convenience: resolve an engine from a raw model ID string.
   * Parses the string into a `QualifiedModelId`; falls back to the default
   * engine when the string is null/empty/unparseable.
   */
  resolveEngineForModel(workspaceKey: string, model: string | null | undefined): ExecutionEngine {
    const qmid = QualifiedModelId.tryParse(model);
    return qmid ? this.getEngineForModel(workspaceKey, qmid) : this.getDefaultEngine(workspaceKey);
  }

  /**
   * Return the engine for the given qualified model ID, respecting the workspace's
   * `allowed_engines` filter.  Falls back to the default engine when the requested
   * engine is not found or not permitted.
   */
  getEngineForModel(workspaceKey: string, qmid: QualifiedModelId): ExecutionEngine {
    const config = this.getWorkspaceConfig(workspaceKey);
    const allowedIds = config.allowedEngineIds;

    const requested = this.engines.get(qmid.engineId);
    if (requested) {
      if (!allowedIds || allowedIds.includes(qmid.engineId)) {
        return requested;
      }
      console.warn(`[engine-registry] Engine '${qmid.engineId}' is not in allowed_engines for workspace '${workspaceKey}' — falling back to default.`);
    }

    return this.getDefaultEngine(workspaceKey);
  }

  /**
   * Return the engine instance by its ID.
   * Returns undefined when no engine with that ID is registered.
   */
  getEngineById(engineId: string): ExecutionEngine | undefined {
    return this.engines.get(engineId);
  }

  /**
   * Return the default engine for a workspace — the first engine in `engines.yaml`
   * order that is permitted by `allowed_engines` (or simply the first overall if no
   * filter is configured).
   */
  getDefaultEngine(workspaceKey: string): ExecutionEngine {
    const config = this.getWorkspaceConfig(workspaceKey);
    const allowedIds = config.allowedEngineIds;

    for (const entry of config.engines) {
      if (!allowedIds || allowedIds.includes(entry.id)) {
        const engine = this.engines.get(entry.id);
        if (engine) return engine;
      }
    }

    // Ultimate fallback: first engine in the registry regardless of workspace filter
    const first = this.engines.values().next().value;
    if (first) return first;

    throw new Error(`[engine-registry] No engines registered for workspace '${workspaceKey}'`);
  }

  /**
   * Return all engines permitted for the given workspace (for model listing /
   * multi-engine aggregation).  Returns engines in `engines.yaml` declaration order.
   */
  listAllEngines(workspaceKey: string): ExecutionEngine[] {
    const config = this.getWorkspaceConfig(workspaceKey);
    const allowedIds = config.allowedEngineIds;

    const result: ExecutionEngine[] = [];
    for (const entry of config.engines) {
      if (allowedIds && !allowedIds.includes(entry.id)) continue;
      const engine = this.engines.get(entry.id);
      if (engine) result.push(engine);
    }
    return result;
  }

  /** Cancels the given executionId on every registered engine instance. */
  cancelAll(executionId: number): void {
    for (const engine of this.engines.values()) {
      engine.cancel(executionId);
    }
  }

  /** Shuts down all registered engine instances gracefully. */
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
}
