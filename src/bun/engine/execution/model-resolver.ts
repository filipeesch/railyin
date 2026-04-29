import type { EngineConfig } from "../../config/index.ts";

/**
 * Resolves the effective model for a task execution using the priority chain:
 *   column.model → task.model → engine.model → ""
 *
 * Empty strings are treated as "not set" (uses `||`, not `??`) so that an
 * empty string falls through to the next source in the chain.
 */
export function resolveTaskModel(
  columnModel: string | null | undefined,
  taskModel: string | null | undefined,
  engineConfig: EngineConfig,
): string {
  const engineDefault = "model" in engineConfig ? (engineConfig.model || null) : null;
  return columnModel || taskModel || engineDefault || "";
}
