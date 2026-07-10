import type { ModelSettingsInfo } from "../../shared/rpc-types.ts";
import type { EngineModelInfo } from "../engine/types.ts";

interface NormalizedModelSettings {
  modelSettings: ModelSettingsInfo;
  rawModelSettings: Record<string, unknown> | null;
}

export function normalizeModelSettings(model: EngineModelInfo | undefined): NormalizedModelSettings {
  return {
    modelSettings: {
      settings: model?.settings ?? [],
    },
    rawModelSettings: null,
  };
}
