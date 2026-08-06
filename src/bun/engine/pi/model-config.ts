import type { PiEngineConfig, PiModelAxisConfig, PiModelConfig } from "../../config/index.ts";

/**
 * Resolve the per-model config for a qualified model id (e.g. "lmstudio/qwen3-8b").
 * Falls back to the model id without the engine prefix (e.g. "qwen3-8b").
 */
export function resolvePiModelConfig(
  config: PiEngineConfig,
  modelId: string | undefined,
): PiModelConfig | undefined {
  if (!modelId) return undefined;
  return config.models?.[modelId] ?? config.models?.[modelId.split("/").slice(1).join("/")];
}

/** Effective token limits + reasoning flags for a model. */
export interface PiModelSettings {
  contextWindow: number | undefined;
  maxTokens: number | undefined;
  reasoning: boolean;
}

export function derivePiModelSettings(
  config: PiEngineConfig,
  modelCfg: PiModelConfig | undefined,
  contextWindowOverride?: number,
): PiModelSettings {
  return {
    contextWindow: modelCfg?.limit?.context ?? contextWindowOverride ?? config.context_window,
    maxTokens: modelCfg?.limit?.output,
    reasoning: modelCfg?.reasoning ?? true,
  };
}

/**
 * Auto-derive the UI axes (Mode from variants, Sampling from presets) for a model,
 * honoring explicit `axes` overrides declared in the model config.
 */
export function derivePiModelAxes(modelCfg: PiModelConfig | undefined): PiModelAxisConfig[] {
  const axes: PiModelAxisConfig[] = [];

  if (modelCfg?.variants && Object.keys(modelCfg.variants).length > 0) {
    const enabled = Object.keys(modelCfg.variants).filter((id) => modelCfg.variants![id].disabled !== true);
    axes.push({
      id: "mode",
      label: "Mode",
      source: "variants",
      options: enabled.map((value) => ({ value, label: value })),
    });
  }

  if (modelCfg?.sampling_presets && Object.keys(modelCfg.sampling_presets).length > 0) {
    const presetNames = Object.keys(modelCfg.sampling_presets);
    axes.push({
      id: "sampling",
      label: "Sampling preset",
      source: "sampling_presets",
      options: presetNames.map((value) => ({ value, label: value })),
    });
  }

  // Explicit axes override auto-derived ones with the same id.
  for (const axis of modelCfg?.axes ?? []) {
    const idx = axes.findIndex((a) => a.id === axis.id);
    if (idx >= 0) axes[idx] = axis;
    else axes.push(axis);
  }

  return axes;
}
