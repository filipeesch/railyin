import type { Database } from "bun:sqlite";
import type { ProviderModelList, ModelInfo } from "../../shared/rpc-types.ts";
import type { ExecutionCoordinator } from "../engine/coordinator.ts";
import type { ModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../workspace-context.ts";
import type { PiEngineConfig, SamplingPreset as ConfigSamplingPreset } from "../config/index.ts";

function requireOrchestrator(o: ExecutionCoordinator | null): ExecutionCoordinator {
  if (!o) throw new Error("Engine not initialized — check workspace config");
  return o;
}

export function modelHandlers(db: Database, orchestrator: ExecutionCoordinator | null, modelSettingsRepo?: ModelSettingsRepository) {
  return {
    // ─── models.list ─────────────────────────────────────────────────────────
    "models.list": async (params: { workspaceKey?: string; engineType?: string } = {}): Promise<ProviderModelList[]> => {
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
        const engineModels = await coord.listModels(workspaceKey, params.engineType);
        const byProvider = new Map<string, typeof engineModels>();
        for (const model of engineModels) {
          if (model.qualifiedId == null) continue;
          const [providerId] = model.qualifiedId.split("/");
          if (!byProvider.has(providerId)) byProvider.set(providerId, []);
          byProvider.get(providerId)!.push(model);
        }

        return Array.from(byProvider.entries()).map(([providerId, models]) => ({
          id: providerId,
          models: models.map((m) => {
            // Apply DB override precedence: DB override → server-reported → null
            const dbOverride = modelSettingsRepo && m.qualifiedId
              ? modelSettingsRepo.getContextWindow(workspaceKey, m.qualifiedId)
              : null;
            const contextWindow = dbOverride ?? m.contextWindow ?? null;
            return {
              id: m.qualifiedId!,
              displayName: m.displayName,
              description: m.description,
              contextWindow,
              enabled: enabledSet.has(m.qualifiedId!),
              ...(m.supportsThinking ? { supportsAdaptiveThinking: true } : {}),
              ...(m.supportsManualCompact ? { supportsManualCompact: true } : {}),
              ...(m.contextWindowEditable ? { contextWindowEditable: true } : {}),
            };
          }),
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

      // Filter models by enabled status - all models treated equally
      const filteredModels = engineModels.filter((m) => 
        m.qualifiedId == null || activeIds.includes(m.qualifiedId)
      );

      const workspaceConfig = getWorkspaceConfig(workspaceKey);

      // Build a map of engineId → presets for all pi-type engines (id may differ from "pi")
      const piPresetsByEngineId = new Map<string, Array<{ name: string; params: ConfigSamplingPreset }>>();
      for (const entry of workspaceConfig.engines) {
        if (entry.config.type === "pi") {
          const piConfig = entry.config as PiEngineConfig;
          if (piConfig.sampling_presets) {
            piPresetsByEngineId.set(
              entry.id,
              Object.entries(piConfig.sampling_presets).map(([name, params]) => ({ name, params })),
            );
          }
        }
      }

      return filteredModels
        .map((m) => {
          const dbOverride = modelSettingsRepo && m.qualifiedId
            ? modelSettingsRepo.getContextWindow(workspaceKey, m.qualifiedId)
            : null;
          const contextWindow = dbOverride ?? m.contextWindow ?? null;
          const engineId = m.qualifiedId != null ? m.qualifiedId.split("/")[0] : "copilot";
          const availablePresets = piPresetsByEngineId.get(engineId);
          return {
            id: m.qualifiedId,
            displayName: m.displayName,
            description: m.description,
            contextWindow,
            supportsManualCompact: m.supportsManualCompact,
            ...(m.contextWindowEditable ? { contextWindowEditable: true } : {}),
            engineId,
            ...(availablePresets ? { availablePresets } : {}),
          };
        })
        .filter((m) => !m.contextWindowEditable || m.contextWindow != null);
    },

    // ─── models.setContextWindow ─────────────────────────────────────────────
    "models.setContextWindow": async (params: { workspaceKey?: string; qualifiedModelId: string; contextWindow: number | null }): Promise<Record<string, never>> => {
      const workspaceKey = params.workspaceKey ?? getDefaultWorkspaceKey();
      if (!modelSettingsRepo) throw new Error("ModelSettingsRepository not available");
      modelSettingsRepo.setContextWindow(workspaceKey, params.qualifiedModelId, params.contextWindow);
      return {};
    },
  };
}
