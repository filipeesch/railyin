import type { ExecutionCoordinator } from "../engine/coordinator.ts";

export function engineHandlers(orchestrator: ExecutionCoordinator | null) {
  return {
    // ─── engine.listCommands ─────────────────────────────────────────────────
    "engine.listCommands": async (params: { taskId: number }) => {
      if (!orchestrator) return [];
      return orchestrator.listCommands(params.taskId);
    },

    // ─── executions.respondShellApproval ─────────────────────────────────────
    "executions.respondShellApproval": async (params: { executionId: number; decision: "approve_once" | "approve_all" | "deny" }): Promise<{ ok: boolean }> => {
      if (!orchestrator) return { ok: false };
      await orchestrator.respondShellApprovalByExecution(params.executionId, params.decision);
      return { ok: true };
    },
  };
}
