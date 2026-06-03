import type { PiEngineConfig, SamplingPreset } from "../../config/index.ts";

/**
 * LLM-facing sampling parameters — the subset of SamplingPreset fields that
 * are actually forwarded into the provider request body.
 *
 * Separate from SamplingPreset (which also carries label/description for UI)
 * so that filterDefined can return a clean, payload-only type.
 */
export type SamplingParams = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  min_p?: number;
};

/**
 * Runtime allowlist of keys that belong in the LLM payload.
 * Keeps filterDefined explicit and maintainable — adding a new sampling
 * param requires updating both SamplingParams and this set.
 */
const SAMPLING_KEYS = new Set<keyof SamplingParams>([
  "temperature",
  "top_p",
  "top_k",
  "presence_penalty",
  "repetition_penalty",
  "frequency_penalty",
  "seed",
  "min_p",
]);

/**
 * Returns a copy of `preset` containing only the LLM-facing fields that are
 * not `undefined`. Guards against accidentally sending `undefined` values or
 * UI-only fields (label, description) to the LLM API payload.
 * Note: a field value of `0` or `false` is intentionally preserved.
 */
function filterDefined(preset: SamplingPreset): SamplingParams {
  return Object.fromEntries(
    Object.entries(preset).filter(
      ([k, v]) => v !== undefined && SAMPLING_KEYS.has(k as keyof SamplingParams),
    ),
  ) as SamplingParams;
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
): SamplingParams | undefined {
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
