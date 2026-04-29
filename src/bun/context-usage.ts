import type { Database } from "bun:sqlite";
import { resolveModelContextWindow } from "./conversation/context.ts";
import { ContextEstimator } from "./conversation/context-estimator.ts";
import type { ExecutionCoordinator } from "./engine/coordinator.ts";

export async function resolveContextWindow(
  model: string,
  workspaceKey: string,
  orchestrator: ExecutionCoordinator | null,
): Promise<number> {
  if (orchestrator) {
    try {
      const models = await orchestrator.listModels(workspaceKey);
      const found = models.find((entry) => entry.qualifiedId === model);
      if (found?.contextWindow != null) return found.contextWindow;
    } catch {
      // fall through to direct resolution
    }
  }

  try {
    return await resolveModelContextWindow(model);
  } catch {
    return 128_000;
  }
}

export function estimateConversationContextUsage(
  db: Database,
  conversationId: number,
  maxTokens: number,
): { usedTokens: number; maxTokens: number; fraction: number } {
  return new ContextEstimator(db).estimate(conversationId, maxTokens);
}
