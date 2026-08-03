import type { Db } from "../../db/db.ts";
import type { ExecutionParams } from "../types.ts";
import type { ModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { ModelParamValue } from "../../../shared/rpc-types.ts";

interface EnrichmentContext {
  workspaceKey: string;
  conversationId: number;
  columnPreset?: string;
  model: string;
}

/**
 * Enriches ExecutionParams with per-conversation overrides (sampling preset, context window).
 *
 * Resolution order for samplingPresetName (highest → lowest priority):
 *   1. conversations.sampling_preset_override  (user-set, persists across transitions)
 *   2. column.sampling_preset                  (workflow YAML)
 *   3. undefined                               (engine uses its own default)
 */
export class ExecutionParamsEnricher {
  constructor(
    private readonly db: Db,
    private readonly modelSettingsRepo?: ModelSettingsRepository,
  ) {}

  async enrich(base: ExecutionParams, ctx: EnrichmentContext): Promise<ExecutionParams> {
    const conversationOverride = await this.loadConversationPreset(ctx.conversationId);
    const samplingPresetName = conversationOverride ?? ctx.columnPreset ?? undefined;
    const modelParams = await this.loadModelParams(ctx.conversationId);

    const contextWindowOverride =
      (await this.modelSettingsRepo?.getContextWindow(ctx.workspaceKey, ctx.model)) ?? undefined;

    return {
      ...base,
      ...(contextWindowOverride != null ? { contextWindowOverride } : {}),
      ...(samplingPresetName !== undefined ? { samplingPresetName } : {}),
      ...(modelParams.length > 0 ? { modelParams } : {}),
    };
  }

  /** Returns whether a context window is configured for the given model. Used for pre-flight checks. */
  async hasContextWindow(workspaceKey: string, model: string): Promise<boolean> {
    return (await this.modelSettingsRepo?.getContextWindow(workspaceKey, model)) != null;
  }

  private async loadModelParams(conversationId: number): Promise<ModelParamValue[]> {
    const row = await this.db.get<{ model_params: string | null }>(
      "SELECT model_params FROM conversations WHERE id = $1",
      [conversationId],
    );
    if (!row?.model_params) return [];
    try {
      const parsed = JSON.parse(row.model_params);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p): p is ModelParamValue =>
          typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.value === "string",
      );
    } catch {
      return [];
    }
  }

  private async loadConversationPreset(conversationId: number): Promise<string | null> {
    const row = await this.db.get<{ sampling_preset_override: string | null }>(
      "SELECT sampling_preset_override FROM conversations WHERE id = $1",
      [conversationId],
    );
    return row?.sampling_preset_override ?? null;
  }
}
