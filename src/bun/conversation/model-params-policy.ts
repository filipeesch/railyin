import type { Db } from "../db/db.ts";
import type { ModelParamValue, ModelSettingAxis } from "../../shared/rpc-types.ts";
import { normalizeModelSettings } from "../models/model-settings-normalizer.ts";
import type { EngineModelInfo } from "../engine/types.ts";

interface ModelParamsPolicyParams {
  conversationId: number;
  engineModel: EngineModelInfo | undefined;
}

/**
 * Enforces model-params compatibility when the selected model changes.
 *
 * - Removes model_params entries whose axis id is not in the new model's settings[].
 * - Removes entries whose value is not valid for the new model's axis.
 * - If no explicit value exists for an axis and the model has a default, persists the default.
 * - If the model has no settings, clears all model_params.
 */
export async function applyModelParamsPolicy(db: Db, params: ModelParamsPolicyParams): Promise<void> {
  const { conversationId, engineModel } = params;

  const normalized = normalizeModelSettings(engineModel);
  const settings: ModelSettingAxis[] = normalized.modelSettings.settings;

  if (settings.length === 0) {
    await db.exec("UPDATE conversations SET model_params = NULL WHERE id = $1", [conversationId]);
    return;
  }

  const row = await db
    .get<{ model_params: string | null }>(
      "SELECT model_params FROM conversations WHERE id = $1",
      [conversationId],
    );

  const current = parseModelParams(row?.model_params ?? null);
  const next = new Map<string, string>();

  // Retain compatible existing values; fall back to defaults for axes without a value
  for (const axis of settings) {
    const existing = current.find((p) => p.id === axis.id);
    if (existing && axis.options.some((o) => o.value === existing.value)) {
      next.set(axis.id, existing.value);
    } else if (axis.defaultValue !== null) {
      next.set(axis.id, axis.defaultValue);
    }
  }

  const nextArray: ModelParamValue[] = Array.from(next.entries()).map(([id, value]) => ({ id, value }));
  const nextJson = nextArray.length > 0 ? JSON.stringify(nextArray) : null;
  await db.exec("UPDATE conversations SET model_params = $1 WHERE id = $2", [nextJson, conversationId]);
}

function parseModelParams(raw: string | null): ModelParamValue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is ModelParamValue =>
        typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.value === "string",
    );
  } catch {
    return [];
  }
}
