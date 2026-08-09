import type { ExecutionCoordinator } from "../engine/coordinator.ts";

export function engineHandlers(orchestrator: ExecutionCoordinator | null) {
  return {
    // ─── engine.listCommands ─────────────────────────────────────────────────
    "engine.listCommands": async (params: { taskId: number }) => {
      if (!orchestrator) return [];
      return orchestrator.listCommands(params.taskId);
    },
  };
}
