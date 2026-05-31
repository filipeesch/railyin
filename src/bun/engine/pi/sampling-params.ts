import type { PiEngineConfig, SamplingPreset } from "../../config/index.ts";

/**
 * Returns a copy of `preset` containing only the fields that are not `undefined`.
 * Guards against accidentally sending `undefined` values to the LLM API payload.
 * Note: a field value of `0` or `false` is intentionally preserved.
 */
function filterDefined(preset: SamplingPreset): SamplingPreset {
  return Object.fromEntries(
    Object.entries(preset).filter(([, v]) => v !== undefined),
  ) as SamplingPreset;
}

/**
 * Resolves the effective sampling preset for a Pi engine execution.
 *
 * Fallback chain:
 *   1. Preset named by `presetName` (from column config)
 *   2. Preset named by `config.default_sampling_preset`
 *   3. `undefined` — no sampling override; LLM provider uses its own defaults
 *
 * If a name is provided but not found in `config.sampling_presets`, a warning is
 * logged and resolution falls through to the next level.
 */
export function resolveSamplingPreset(
  presetName: string | undefined,
  config: PiEngineConfig,
): SamplingPreset | undefined {
  const presets = config.sampling_presets ?? {};

  if (presetName !== undefined) {
    const preset = presets[presetName];
    if (preset !== undefined) {
      return filterDefined(preset);
    }
    console.warn(
      `[PiEngine] sampling_preset "${presetName}" not found in engine config — falling back to default`,
    );
  }

  if (config.default_sampling_preset !== undefined) {
    const defaultPreset = presets[config.default_sampling_preset];
    if (defaultPreset !== undefined) {
      return filterDefined(defaultPreset);
    }
    console.warn(
      `[PiEngine] default_sampling_preset "${config.default_sampling_preset}" not found in engine config — no sampling override`,
    );
  }

  return undefined;
}
