import type { Database } from "bun:sqlite";
import type { ProviderModelList, ModelInfo } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import { getDefaultWorkspaceKey } from "../workspace-context.ts";

function requireOrchestrator(o: ExecutionCoordinator | null): ExecutionCoordinator {
  if (!o) throw new Error("Engine not initialized — check workspace config");
  return o;
}

export function modelHandlers(db: Database, orchestrator: ExecutionCoordinator | null) {
  return {
    // ─── models.list ─────────────────────────────────────────────────────────
    "models.list": async (params: { workspaceKey?: string } = {}): Promise<ProviderModelList[]> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      const coord = requireOrchestrator(orchestrator);

      const enabledSet = new Set(
        db
          .query<{ qualified_model_id: string }, [string]>(
            "SELECT qualified_model_id FROM enabled_models WHERE workspace_key = ?",
          )
          .all(workspaceKey)
          .map((r) => r.qualified_model_id),
      );

      try {
        const engineModels = await coord.listModels(workspaceKey);
        const byProvider = new Map<string, typeof engineModels>();
        for (const model of engineModels) {
          if (model.qualifiedId == null) continue;
          const [providerId] = model.qualifiedId.split("/");
          if (!byProvider.has(providerId)) byProvider.set(providerId, []);
          byProvider.get(providerId)!.push(model);
        }

        return Array.from(byProvider.entries()).map(([providerId, models]) => ({
          id: providerId,
          models: models.map((m) => ({
            id: m.qualifiedId,
            displayName: m.displayName,
            description: m.description,
            contextWindow: m.contextWindow,
            enabled: enabledSet.has(m.qualifiedId),
            ...(m.supportsThinking ? { supportsAdaptiveThinking: true } : {}),
            ...(m.supportsManualCompact ? { supportsManualCompact: true } : {}),
          })),
        }));
      } catch (err) {
        return [
          {
            id: "error",
            models: [],
            error: err instanceof Error ? err.message : String(err),
          },
        ];
      }
    },

    // ─── models.setEnabled ───────────────────────────────────────────────────
    "models.setEnabled": async (params: { workspaceKey?: string; qualifiedModelId: string; enabled: boolean }): Promise<Record<string, never>> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      if (params.enabled) {
        db.run(
          "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES (?, ?)",
          [workspaceKey, params.qualifiedModelId],
        );
      } else {
        db.run(
          "DELETE FROM enabled_models WHERE workspace_key = ? AND qualified_model_id = ?",
          [workspaceKey, params.qualifiedModelId],
        );
      }
      return {};
    },

    // ─── models.listEnabled ──────────────────────────────────────────────────
    // Cross-references the DB with the engine's actual model list so stale entries
    // from previous engine configurations are silently dropped. If none of the
    // enabled DB entries match the current engine, all engine models are returned
    // (default-all-enabled behaviour on first use / engine switch).
    "models.listEnabled": async (params: { workspaceKey?: string } = {}): Promise<ModelInfo[]> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      if (!orchestrator) return [];

      const [engineModels, dbRows] = await Promise.all([
        orchestrator.listModels(workspaceKey),
        db
          .query<{ qualified_model_id: string }, [string]>(
            "SELECT qualified_model_id FROM enabled_models WHERE workspace_key = ? ORDER BY qualified_model_id",
          )
          .all(workspaceKey),
      ]);

      const concreteEngineIds = new Set(
        engineModels
          .map((m) => m.qualifiedId)
          .filter((id): id is string => id != null),
      );
      const enabledIds = dbRows.map((r) => r.qualified_model_id).filter((id) => concreteEngineIds.has(id));

      // No overlap → engine switched or first use; treat all engine models as enabled.
      const activeIds = enabledIds.length > 0 ? enabledIds : [...concreteEngineIds];

      return engineModels
        .filter((m) => m.qualifiedId == null || activeIds.includes(m.qualifiedId))
        .map((m) => ({
          id: m.qualifiedId,
          displayName: m.displayName,
          description: m.description,
          contextWindow: m.contextWindow ?? null,
          supportsManualCompact: m.supportsManualCompact,
        }));
    },
  };
}
